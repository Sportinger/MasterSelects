import { describe, expect, it, vi } from 'vitest';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
} from '../../src/stores/flashboardStore/types';
import {
  cancelStoryboardGeneration,
  executeStoryboardGenerationRestoreActions,
  reconcileStoryboardGenerationRecords,
} from '../../src/services/storyboard/generation';

function request(
  key: string,
  outputType: 'audio' | 'image' | 'video' = 'video',
): FlashBoardGenerationRequest {
  return {
    service: 'cloud',
    providerId: outputType === 'audio' ? 'cloud-elevenlabs-tts' : 'cloud-kling',
    version: 'latest',
    idempotencyKey: key,
    outputType,
    prompt: 'Generate.',
    duration: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
  };
}

function candidate(
  id: string,
  requestKey: string,
  recordId?: string,
): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id,
    sceneId: 'scene-restore',
    kind: 'generated-video',
    state: recordId ? 'queued' : 'awaiting-approval',
    generationBriefRevision: 1,
    generationRequestKey: requestKey,
    ...(recordId ? { generationRecordId: recordId } : {}),
    sourceMomentHandles: [],
    createdAt: 1,
  };
}

function state(candidates: StoryboardCandidate[]): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-restore'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-restore': {
        schemaVersion: 1,
        id: 'scene-restore',
        planId: 'plan',
        title: 'Scene',
        description: 'Description',
        targetDurationSeconds: 5,
        status: 'generating',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {},
    candidates: Object.fromEntries(candidates.map((item) => [item.id, item])),
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

function record(
  id: string,
  generationRequest: FlashBoardGenerationRequest,
  job: NonNullable<FlashBoardActiveGenerationRecord['job']>,
): FlashBoardActiveGenerationRecord {
  return {
    id,
    kind: 'generation',
    createdAt: 2,
    updatedAt: 3,
    request: generationRequest,
    job,
  };
}

describe('storyboard generation restore and cancellation', () => {
  it('reconciles project records and only replays durable queued work', () => {
    const records = [
      record('record-resubmit', request('storyboard-generation:restore:0'), {
        status: 'queued',
      }),
      record('record-resume', request('storyboard-generation:restore:1'), {
        status: 'processing',
        remoteTaskId: 'remote-1',
      }),
      record(
        'record-unsafe',
        request('storyboard-generation:restore:2', 'audio'),
        { status: 'queued' },
      ),
    ];
    const reconciled = reconcileStoryboardGenerationRecords(state([
      candidate('candidate-resubmit', 'storyboard-generation:restore:0', 'record-resubmit'),
      candidate('candidate-resume', 'storyboard-generation:restore:1', 'record-resume'),
      candidate('candidate-unsafe', 'storyboard-generation:restore:2', 'record-unsafe'),
    ]), records);

    expect(reconciled.actions.map((action) => action.kind)).toEqual([
      'resubmit-idempotently',
      'resume',
      'needs-confirmation',
    ]);
    expect(reconciled.state.candidates['candidate-resume'].state).toBe('processing');

    const ports = {
      hasJob: vi.fn(() => false),
      resume: vi.fn(),
      submit: vi.fn(),
    };
    const first = executeStoryboardGenerationRestoreActions(reconciled.actions, ports);
    const second = executeStoryboardGenerationRestoreActions(reconciled.actions, ports);
    expect(first.executedRecordIds).toEqual(['record-resubmit', 'record-resume']);
    expect(first.failed).toEqual([]);
    expect(first.needsConfirmationRecordIds).toEqual(['record-unsafe']);
    expect(second.executedRecordIds).toEqual([]);
    expect(ports.submit).toHaveBeenCalledTimes(1);
    expect(ports.resume).toHaveBeenCalledTimes(1);
  });

  it('isolates a restore transport failure and keeps later actions retryable', () => {
    const actions = [
      {
        kind: 'resubmit-idempotently' as const,
        recordId: 'record-fails',
        request: request('storyboard-generation:restore:failure'),
      },
      {
        kind: 'resume' as const,
        recordId: 'record-continues',
        remoteTaskId: 'remote-continues',
        request: request('storyboard-generation:restore:continues'),
      },
    ];
    const submit = vi.fn(() => {
      throw new Error('temporary transport failure');
    });
    const resume = vi.fn();
    const result = executeStoryboardGenerationRestoreActions(actions, {
      hasJob: () => false,
      resume,
      submit,
    });

    expect(result).toEqual({
      executedRecordIds: ['record-continues'],
      failed: [{
        error: 'temporary transport failure',
        recordId: 'record-fails',
      }],
      needsConfirmationRecordIds: [],
    });
    expect(resume).toHaveBeenCalledOnce();

    submit.mockImplementation(() => undefined);
    const retry = executeStoryboardGenerationRestoreActions(actions, {
      hasJob: () => false,
      resume,
      submit,
    });
    expect(retry.executedRecordIds).toEqual(['record-fails']);
    expect(retry.failed).toEqual([]);
  });

  it('maps completed imported output to ready during project reconcile', () => {
    const completed = record(
      'record-complete',
      request('storyboard-generation:restore:complete'),
      { status: 'completed' },
    );
    completed.results = [{
      mediaFileId: 'media-ready',
      mediaType: 'video',
      duration: 5,
    }];
    const reconciled = reconcileStoryboardGenerationRecords(state([
      candidate(
        'candidate-complete',
        'storyboard-generation:restore:complete',
        'record-complete',
      ),
    ]), [completed]);
    expect(reconciled.actions).toEqual([]);
    expect(reconciled.state.candidates['candidate-complete']).toMatchObject({
      state: 'ready',
      mediaFileId: 'media-ready',
    });
  });

  it('keeps a terminal local import failure honest instead of waiting forever', () => {
    const completed = record(
      'record-import-failed',
      request('storyboard-generation:restore:import-failed'),
      { status: 'completed' },
    );
    completed.outputs = [{
      id: 'output-import-failed',
      mediaType: 'video',
      availability: 'completed',
      importStatus: 'failed',
      importError: 'download checksum mismatch',
    }];
    const reconciled = reconcileStoryboardGenerationRecords(state([
      candidate(
        'candidate-import-failed',
        'storyboard-generation:restore:import-failed',
        completed.id,
      ),
    ]), [completed]);

    expect(reconciled.actions).toEqual([]);
    expect(Object.values(reconciled.state.candidates)).toEqual([
      expect.objectContaining({
        generationRecordId: completed.id,
        outputId: 'output-import-failed',
        state: 'failed',
      }),
    ]);
  });

  it('cancels an awaiting-approval candidate without touching a provider', () => {
    const cancelJob = vi.fn();
    const initial = state([
      candidate('candidate-prepared', 'storyboard-generation:cancel:0'),
    ]);
    const result = cancelStoryboardGeneration({
      candidateId: 'candidate-prepared',
      ports: {
        cancelJob,
        getRecord: () => undefined,
        updateJob: vi.fn(),
      },
      state: initial,
    });
    expect(result).toMatchObject({
      billingMayContinue: false,
      disposition: 'canceled-before-submission',
    });
    expect(result.state.candidates['candidate-prepared'].state).toBe('canceled');
    expect(cancelJob).not.toHaveBeenCalled();
  });

  it('cancels a prepared draft record before provider submission', () => {
    const draft = record(
      'record-draft',
      request('storyboard-generation:cancel:draft'),
      { status: 'draft' },
    );
    const cancelJob = vi.fn();
    const updateJob = vi.fn();
    const result = cancelStoryboardGeneration({
      candidateId: 'candidate-draft',
      ports: {
        cancelJob,
        getRecord: () => draft,
        updateJob,
      },
      state: state([
        candidate(
          'candidate-draft',
          'storyboard-generation:cancel:draft',
          draft.id,
        ),
      ]),
    });
    expect(result.disposition).toBe('canceled-before-submission');
    expect(result.billingMayContinue).toBe(false);
    expect(cancelJob).not.toHaveBeenCalled();
    expect(updateJob).toHaveBeenCalledWith(draft.id, { status: 'canceled' });
  });

  it('reports processing cancellation honestly and preserves the record', () => {
    const processing = record(
      'record-processing',
      request('storyboard-generation:cancel:1'),
      { status: 'processing', remoteTaskId: 'remote-processing' },
    );
    const updateJob = vi.fn();
    const result = cancelStoryboardGeneration({
      candidateId: 'candidate-processing',
      ports: {
        cancelJob: () => ({
          billingMayContinue: true,
          disposition: 'cancel-requested',
          recordId: processing.id,
          remoteTaskId: 'remote-processing',
        }),
        getRecord: () => processing,
        updateJob,
      },
      state: state([
        candidate(
          'candidate-processing',
          'storyboard-generation:cancel:1',
          processing.id,
        ),
      ]),
    });
    expect(result).toMatchObject({
      billingMayContinue: true,
      disposition: 'cancel-requested',
    });
    expect(result.state.candidates['candidate-processing'].state).toBe('processing');
    expect(updateJob).toHaveBeenCalledWith(processing.id, expect.objectContaining({
      status: 'processing',
      error: expect.stringMatching(/billing may continue/i),
    }));
  });

  it('lets completion win a cancellation race and marks it billable', () => {
    const racing = record(
      'record-race',
      request('storyboard-generation:cancel:race'),
      { status: 'processing', remoteTaskId: 'remote-race' },
    );
    const result = cancelStoryboardGeneration({
      candidateId: 'candidate-race',
      ports: {
        cancelJob: () => {
          racing.job = { status: 'completed', remoteTaskId: 'remote-race' };
          racing.results = [{
            mediaFileId: 'media-race',
            mediaType: 'video',
            duration: 5,
          }];
          return {
            billingMayContinue: true,
            disposition: 'cancel-requested',
            recordId: racing.id,
            remoteTaskId: 'remote-race',
          };
        },
        getRecord: () => racing,
        updateJob: vi.fn(),
      },
      state: state([
        candidate(
          'candidate-race',
          'storyboard-generation:cancel:race',
          racing.id,
        ),
      ]),
    });
    expect(result).toMatchObject({
      billingMayContinue: true,
      disposition: 'completed-billable',
    });
    expect(result.state.candidates['candidate-race']).toMatchObject({
      state: 'ready',
      mediaFileId: 'media-race',
    });
  });
});
