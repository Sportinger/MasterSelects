import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  approvePreparedStoryboardGeneration,
  cancelStoryboardGeneration,
  prepareStoryboardGeneration,
  submitPreparedStoryboardGeneration,
} from '../../src/services/storyboard/generation';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
} from '../../src/stores/flashboardStore/types';

const exactQuote = {
  amount: 7,
  exact: true as const,
  pricingVersion: 'stress-price-v1',
  unit: 'hosted-credit' as const,
};

const catalog: CatalogEntry[] = [{
  service: 'cloud',
  providerId: 'cloud-kling',
  name: 'Hosted Kling',
  description: 'Exact hosted stress route',
  versions: ['latest'],
  modes: ['std'],
  durations: [5],
  aspectRatios: ['16:9'],
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  supportsGenerateAudio: true,
  outputType: 'video',
}];

function brief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-generation-stress',
    sceneId: 'scene-generation-stress',
    revision: 1,
    prompt: 'A measured tracking shot through a quiet station.',
    durationSeconds: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

function state(candidates: StoryboardCandidate[] = []): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      'plan-generation-stress': {
        schemaVersion: 1,
        id: 'plan-generation-stress',
        title: 'Generation stress',
        sceneIds: ['scene-generation-stress'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-generation-stress': {
        schemaVersion: 1,
        id: 'scene-generation-stress',
        planId: 'plan-generation-stress',
        title: 'Station',
        description: 'A quiet station at night.',
        targetDurationSeconds: 5,
        status: 'ready',
        generationBriefId: 'brief-generation-stress',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: { 'brief-generation-stress': brief() },
    candidates: Object.fromEntries(candidates.map((candidate) => [
      candidate.id,
      candidate,
    ])),
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

function recordFor(
  request: FlashBoardGenerationRequest,
  index: number,
): FlashBoardActiveGenerationRecord {
  return {
    id: `record-generation-stress-${index}`,
    kind: 'generation',
    createdAt: 20 + index,
    updatedAt: 20 + index,
    request,
    job: { status: 'draft' },
  };
}

function lifecycleCandidate(
  id: string,
  generationRecordId?: string,
): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id,
    sceneId: 'scene-generation-stress',
    kind: 'generated-video',
    state: generationRecordId ? 'processing' : 'awaiting-approval',
    generationBriefRevision: 1,
    generationRequestKey: `storyboard-generation:stress:${id}`,
    ...(generationRecordId ? { generationRecordId } : {}),
    sourceMomentHandles: [],
    createdAt: 1,
  };
}

describe('storyboard generation submission and cancellation stress', () => {
  it('coalesces a maximum-size approved batch and retries only partial failures', async () => {
    const prepared = await prepareStoryboardGeneration({
      availability: { hostedAvailable: true },
      brief: brief(),
      candidateCount: 16,
      catalogEntries: catalog,
      now: 10,
      pricingPort: () => exactQuote,
      projectId: 'project-generation-stress',
      userId: 'user-generation-stress',
    });
    const approval = await approvePreparedStoryboardGeneration(prepared, {
      explicitUserApproval: true,
      maxSpend: exactQuote.amount * prepared.candidateCount,
      now: 10,
      priceUnit: exactQuote.unit,
      projectId: 'project-generation-stress',
      userId: 'user-generation-stress',
    });

    const records: FlashBoardActiveGenerationRecord[] = [];
    const persistedStates: StoryboardProjectState[] = [];
    const providerStarts = new Map<string, number>();
    const startAttempts = new Map<string, number>();
    const failOnce = new Set([3, 11]);
    const createRecord = vi.fn((request: FlashBoardGenerationRequest) => {
      const index = prepared.entries.findIndex(
        (entry) => entry.generationRequestKey === request.idempotencyKey,
      );
      const record = recordFor(request, index);
      records.push(record);
      return record;
    });
    const startRecord = vi.fn((recordId: string) => {
      const record = records.find((candidate) => candidate.id === recordId)!;
      const index = Number(recordId.split('-').at(-1));
      const attempts = (startAttempts.get(recordId) ?? 0) + 1;
      startAttempts.set(recordId, attempts);
      if (failOnce.has(index) && attempts === 1) {
        throw new Error(`temporary provider boundary failure ${index}`);
      }
      providerStarts.set(recordId, (providerStarts.get(recordId) ?? 0) + 1);
      record.job = { status: 'queued' };
      return record;
    });
    const currentPricing = vi.fn(() => exactQuote);
    const input = {
      now: 20,
      ports: {
        createRecord,
        listRecords: () => records,
        persistState: async (projectState: StoryboardProjectState) => {
          await Promise.resolve();
          persistedStates.push(projectState);
        },
        startRecord,
      },
      prepared,
      pricingPort: currentPricing,
      projectId: 'project-generation-stress',
      state: state(),
      token: approval.token,
      userId: 'user-generation-stress',
    };

    const firstPromise = submitPreparedStoryboardGeneration(input);
    const duplicatePromise = submitPreparedStoryboardGeneration(input);
    expect(duplicatePromise).toBe(firstPromise);

    const first = await firstPromise;
    expect(first.status).toBe('partial');
    expect(first.entries.filter((entry) => entry.status === 'failed')).toHaveLength(2);
    expect(createRecord).toHaveBeenCalledTimes(16);
    expect(currentPricing).toHaveBeenCalledTimes(16);
    expect(records).toHaveLength(16);
    expect(new Set(records.map((record) => record.request?.idempotencyKey)).size)
      .toBe(16);
    expect(persistedStates.length).toBeGreaterThan(16);

    const failedCandidateIds = first.entries
      .filter((entry) => entry.status === 'failed')
      .map((entry) => entry.candidateId);
    for (const candidateId of failedCandidateIds) {
      expect(first.state.candidates[candidateId]).toMatchObject({
        generationRecordId: expect.any(String),
        state: 'failed',
      });
    }

    const retried = await submitPreparedStoryboardGeneration({
      ...input,
      now: 21,
      state: first.state,
    });
    expect(retried.status).toBe('submitted');
    expect(retried.entries.filter((entry) => entry.status === 'submitted'))
      .toHaveLength(2);
    expect(retried.entries.filter((entry) => entry.status === 'reused'))
      .toHaveLength(14);
    expect(createRecord).toHaveBeenCalledTimes(16);
    expect(currentPricing).toHaveBeenCalledTimes(32);
    expect(startRecord).toHaveBeenCalledTimes(18);
    expect([...providerStarts.values()].every((count) => count === 1)).toBe(true);
    expect(providerStarts.size).toBe(16);
    expect(Object.values(retried.state.candidates).every((candidate) => (
      candidate.generationRecordId
      && candidate.generationRequestKey
      && candidate.state === 'queued'
    ))).toBe(true);
  });

  it('keeps cancellation and billing claims honest across large lifecycle sets', () => {
    const records = new Map<string, FlashBoardActiveGenerationRecord>();
    const candidates: StoryboardCandidate[] = [];
    const groupSize = 24;
    for (let index = 0; index < groupSize; index += 1) {
      candidates.push(lifecycleCandidate(`awaiting-${index}`));
      for (const lifecycle of ['draft', 'processing', 'completed'] as const) {
        const recordId = `record-${lifecycle}-${index}`;
        candidates.push(lifecycleCandidate(`${lifecycle}-${index}`, recordId));
        records.set(recordId, {
          id: recordId,
          kind: 'generation',
          createdAt: index,
          updatedAt: index,
          request: {
            service: 'cloud',
            providerId: 'cloud-kling',
            version: 'latest',
            idempotencyKey: `storyboard-generation:cancel:${lifecycle}:${index}`,
            outputType: 'video',
            prompt: 'Generate.',
            duration: 5,
            aspectRatio: '16:9',
            referenceMediaFileIds: [],
          },
          job: lifecycle === 'processing'
            ? {
                status: 'processing',
                remoteTaskId: `remote-${index}`,
                refund: {
                  creditBalance: 100,
                  credits: 7,
                  jobId: recordId,
                },
              }
            : { status: lifecycle },
          ...(lifecycle === 'completed'
            ? {
                results: [{
                  mediaFileId: `media-completed-${index}`,
                  mediaType: 'video' as const,
                  outputId: `output-completed-${index}`,
                  duration: 5,
                }],
              }
            : {}),
        });
      }
    }

    let current = state(candidates);
    const cancelJob = vi.fn((recordId: string) => ({
      billingMayContinue: true,
      disposition: 'cancel-requested' as const,
      recordId,
      remoteTaskId: records.get(recordId)?.job?.remoteTaskId,
    }));
    const updateJob = vi.fn((
      recordId: string,
      patch: {
        error?: string;
        remoteTaskId?: string;
        status: 'canceled' | 'processing';
      },
    ) => {
      const record = records.get(recordId)!;
      record.job = { ...record.job, ...patch };
    });
    const dispositions = {
      canceledBeforeSubmission: 0,
      cancelRequested: 0,
      completedBillable: 0,
    };

    for (const candidate of candidates) {
      const result = cancelStoryboardGeneration({
        candidateId: candidate.id,
        ports: {
          cancelJob,
          getRecord: (recordId) => records.get(recordId),
          updateJob,
        },
        state: current,
      });
      current = result.state;
      if (result.disposition === 'canceled-before-submission') {
        dispositions.canceledBeforeSubmission += 1;
        expect(result.billingMayContinue).toBe(false);
      } else if (result.disposition === 'cancel-requested') {
        dispositions.cancelRequested += 1;
        expect(result.billingMayContinue).toBe(true);
      } else {
        dispositions.completedBillable += 1;
        expect(result.billingMayContinue).toBe(true);
      }
    }

    expect(dispositions).toEqual({
      canceledBeforeSubmission: groupSize * 2,
      cancelRequested: groupSize,
      completedBillable: groupSize,
    });
    expect(cancelJob).toHaveBeenCalledTimes(groupSize);
    expect(updateJob).toHaveBeenCalledTimes(groupSize * 2);
    expect(Object.values(current.candidates).filter(
      (candidate) => candidate.state === 'canceled',
    )).toHaveLength(groupSize * 2);
    expect(Object.values(current.candidates).filter(
      (candidate) => candidate.state === 'processing',
    )).toHaveLength(groupSize);
    expect(Object.values(current.candidates).filter(
      (candidate) => candidate.state === 'ready',
    )).toHaveLength(groupSize);
    expect([...records.values()]
      .filter((record) => record.id.startsWith('record-processing-'))
      .every((record) => record.job?.refund?.credits === 7)).toBe(true);
  });
});
