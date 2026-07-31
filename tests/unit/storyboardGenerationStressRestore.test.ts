import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeStoryboardProjectState,
  encodeStoryboardProjectState,
} from '../../src/services/project/storyboard';
import {
  createGenerationCandidateId,
} from '../../src/services/storyboard/candidates';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  executeStoryboardGenerationRestoreActions,
  reconcileStoryboardGenerationRecords,
} from '../../src/services/storyboard/generation';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
  FlashBoardJobState,
} from '../../src/stores/flashboardStore/types';
import {
  getFlashBoardActiveGenerationRecord,
  hydrateFlashBoardActiveGenerationRecords,
  markFlashBoardGenerationOutputImportFailed,
} from '../../src/stores/flashboardStore/activeGenerationRecords';

afterEach(() => {
  hydrateFlashBoardActiveGenerationRecords([]);
});

function request(
  key: string,
  outputType: 'audio' | 'image' | 'video' = 'video',
): FlashBoardGenerationRequest {
  return {
    service: 'cloud',
    providerId: outputType === 'audio'
      ? 'cloud-elevenlabs-tts'
      : 'cloud-kling',
    version: 'latest',
    idempotencyKey: key,
    outputType,
    prompt: 'Generate a reload-safe candidate.',
    duration: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
  };
}

function candidate(
  id: string,
  generationRequestKey: string,
  generationRecordId?: string,
  kind: StoryboardCandidate['kind'] = 'generated-video',
): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id,
    sceneId: 'scene-generation-restore-stress',
    kind,
    state: generationRecordId ? 'queued' : 'awaiting-approval',
    generationBriefRevision: 1,
    generationRequestKey,
    ...(generationRecordId ? { generationRecordId } : {}),
    sourceMomentHandles: [],
    createdAt: 1,
  };
}

function state(candidates: StoryboardCandidate[]): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      'plan-generation-restore-stress': {
        schemaVersion: 1,
        id: 'plan-generation-restore-stress',
        title: 'Generation restore stress',
        sceneIds: ['scene-generation-restore-stress'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-generation-restore-stress': {
        schemaVersion: 1,
        id: 'scene-generation-restore-stress',
        planId: 'plan-generation-restore-stress',
        title: 'Restore',
        description: 'Restore a large asynchronous candidate set.',
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
    candidates: Object.fromEntries(candidates.map((entry) => [entry.id, entry])),
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
  job: FlashBoardJobState,
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

function countActions(
  actions: ReturnType<typeof reconcileStoryboardGenerationRecords>['actions'],
): Record<string, number> {
  return actions.reduce<Record<string, number>>((counts, action) => {
    counts[action.kind] = (counts[action.kind] ?? 0) + 1;
    return counts;
  }, {});
}

describe('storyboard generation reload and output stress', () => {
  it('marks only the targeted import output terminal and sanitizes its error', () => {
    const completed = {
      ...record(
        'record-import-producer-stress',
        request('storyboard-generation:import-producer-stress'),
        { status: 'completed' },
      ),
      outputs: [0, 1].map((index) => ({
        id: `output-import-producer-${index}`,
        mediaType: 'video' as const,
        availability: 'completed' as const,
      })),
    };
    hydrateFlashBoardActiveGenerationRecords([completed]);

    markFlashBoardGenerationOutputImportFailed(
      completed.id,
      'output-import-producer-0',
      `sensitive-prefix:${'x'.repeat(600)}`,
    );
    const firstRecord = getFlashBoardActiveGenerationRecord(completed.id)!;
    expect(firstRecord.outputs).toEqual([
      expect.objectContaining({
        id: 'output-import-producer-0',
        importStatus: 'failed',
        importError: expect.any(String),
      }),
      expect.not.objectContaining({
        importStatus: 'failed',
      }),
    ]);
    expect(firstRecord.outputs?.[0]?.importError).toHaveLength(500);

    const firstReconcile = reconcileStoryboardGenerationRecords(state([
      candidate(
        'prepared-import-producer',
        'storyboard-generation:import-producer-stress',
        completed.id,
      ),
    ]), JSON.parse(JSON.stringify([firstRecord])) as FlashBoardActiveGenerationRecord[]);
    expect(firstReconcile.actions).toEqual([{
      kind: 'awaiting-import',
      recordId: completed.id,
    }]);
    expect(Object.values(firstReconcile.state.candidates).map(
      (entry) => entry.state,
    ).toSorted()).toEqual(['failed', 'processing']);

    markFlashBoardGenerationOutputImportFailed(
      completed.id,
      'output-import-producer-1',
      'second terminal import failure',
    );
    const terminalRecord = getFlashBoardActiveGenerationRecord(completed.id)!;
    const terminal = reconcileStoryboardGenerationRecords(
      firstReconcile.state,
      JSON.parse(
        JSON.stringify([terminalRecord]),
      ) as FlashBoardActiveGenerationRecord[],
    );
    expect(terminal.actions).toEqual([]);
    expect(Object.values(terminal.state.candidates).every(
      (entry) => entry.state === 'failed',
    )).toBe(true);
  });

  it('reconciles and executes a large mixed restore queue exactly once', () => {
    const candidates: StoryboardCandidate[] = [];
    const records: FlashBoardActiveGenerationRecord[] = [];
    const groupSize = 40;

    for (let index = 0; index < groupSize; index += 1) {
      const queuedKey = `storyboard-generation:restore-stress:queued:${index}`;
      const queuedId = `record-restore-stress-queued-${index}`;
      candidates.push(candidate(
        `candidate-restore-stress-queued-${index}`,
        queuedKey,
        index % 2 === 0 ? queuedId : undefined,
      ));
      records.push(record(queuedId, request(queuedKey), { status: 'queued' }));

      const processingKey =
        `storyboard-generation:restore-stress:processing:${index}`;
      const processingId = `record-restore-stress-processing-${index}`;
      candidates.push(candidate(
        `candidate-restore-stress-processing-${index}`,
        processingKey,
        index % 2 === 0 ? processingId : undefined,
      ));
      records.push(record(processingId, request(processingKey), {
        status: 'processing',
        remoteTaskId: `remote-restore-stress-${index}`,
      }));
    }

    for (let index = 0; index < groupSize / 2; index += 1) {
      const unsafeKey = `storyboard-generation:restore-stress:unsafe:${index}`;
      const unsafeId = `record-restore-stress-unsafe-${index}`;
      candidates.push(candidate(
        `candidate-restore-stress-unsafe-${index}`,
        unsafeKey,
        unsafeId,
        'generated-audio',
      ));
      records.push(record(
        unsafeId,
        request(unsafeKey, 'audio'),
        { status: 'queued' },
      ));

      const awaitingImportKey =
        `storyboard-generation:restore-stress:awaiting-import:${index}`;
      const awaitingImportId =
        `record-restore-stress-awaiting-import-${index}`;
      candidates.push(candidate(
        `candidate-restore-stress-awaiting-import-${index}`,
        awaitingImportKey,
        awaitingImportId,
      ));
      records.push(record(
        awaitingImportId,
        request(awaitingImportKey),
        { status: 'completed' },
      ));

      const failedKey = `storyboard-generation:restore-stress:failed:${index}`;
      const failedId = `record-restore-stress-failed-${index}`;
      candidates.push(candidate(
        `candidate-restore-stress-failed-${index}`,
        failedKey,
        failedId,
      ));
      records.push(record(failedId, request(failedKey), {
        status: 'failed',
        error: 'provider rejected the request',
      }));
    }

    const reloadedState = decodeStoryboardProjectState(
      encodeStoryboardProjectState(state(candidates)),
    ).state;
    const reloadedRecords = JSON.parse(
      JSON.stringify(records),
    ) as FlashBoardActiveGenerationRecord[];
    const reconciled = reconcileStoryboardGenerationRecords(
      reloadedState,
      reloadedRecords,
    );

    expect(countActions(reconciled.actions)).toEqual({
      'resubmit-idempotently': groupSize,
      resume: groupSize,
      'needs-confirmation': groupSize / 2,
      'awaiting-import': groupSize / 2,
    });
    expect(Object.values(reconciled.state.candidates).every(
      (entry) => Boolean(entry.generationRecordId),
    )).toBe(true);
    expect(Object.values(reconciled.state.candidates).filter(
      (entry) => entry.state === 'failed',
    )).toHaveLength(groupSize / 2);
    expect(Object.values(reconciled.state.candidates).filter(
      (entry) => entry.state === 'processing',
    )).toHaveLength(groupSize + groupSize / 2);

    const ports = {
      hasJob: vi.fn(() => false),
      resume: vi.fn(),
      submit: vi.fn(),
    };
    const first = executeStoryboardGenerationRestoreActions(
      reconciled.actions,
      ports,
    );
    const replay = executeStoryboardGenerationRestoreActions(
      reconciled.actions,
      ports,
    );

    expect(first.executedRecordIds).toHaveLength(groupSize * 2);
    expect(new Set(first.executedRecordIds).size).toBe(groupSize * 2);
    expect(first.needsConfirmationRecordIds).toHaveLength(groupSize / 2);
    expect(replay.executedRecordIds).toEqual([]);
    expect(replay.needsConfirmationRecordIds).toHaveLength(groupSize / 2);
    expect(ports.submit).toHaveBeenCalledTimes(groupSize);
    expect(ports.resume).toHaveBeenCalledTimes(groupSize);
  });

  it('keeps hundreds of partial multi-output links stable and honest after reload', () => {
    const recordCount = 64;
    const outputCount = 4;
    const candidates: StoryboardCandidate[] = [];
    const records: FlashBoardActiveGenerationRecord[] = [];

    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      const recordId = `record-output-stress-${recordIndex}`;
      const requestKey = `storyboard-generation:output-stress:${recordIndex}`;
      candidates.push(candidate(
        `prepared-output-stress-${recordIndex}`,
        requestKey,
        recordId,
      ));
      records.push({
        ...record(recordId, request(requestKey), {
          status: 'completed',
        }),
        outputs: Array.from({ length: outputCount }, (_, outputIndex) => ({
          id: `output-${recordIndex}-${outputIndex}`,
          mediaType: 'video' as const,
          availability: 'completed' as const,
          ...(outputIndex % 2 === 1
            ? {
                importStatus: 'failed' as const,
                importError: `terminal import failure ${recordIndex}:${outputIndex}`,
              }
            : {}),
          duration: 5 + outputIndex,
          downloadUrl:
            `https://provider.invalid/${recordIndex}/${outputIndex}.mp4`,
        })),
        results: Array.from({ length: outputCount / 2 }, (_, resultIndex) => {
          const outputIndex = resultIndex * 2;
          return {
            outputId: `output-${recordIndex}-${outputIndex}`,
            mediaFileId: `media-${recordIndex}-${outputIndex}`,
            mediaType: 'video' as const,
            duration: 5 + outputIndex,
          };
        }),
      });
    }

    const first = reconcileStoryboardGenerationRecords(
      state(candidates),
      records,
    );
    const firstCandidates = Object.values(first.state.candidates);
    expect(firstCandidates).toHaveLength(recordCount * outputCount);
    expect(firstCandidates.filter((entry) => entry.state === 'ready'))
      .toHaveLength(recordCount * outputCount / 2);
    expect(firstCandidates.filter((entry) => entry.state === 'failed'))
      .toHaveLength(recordCount * outputCount / 2);
    expect(first.actions).toEqual([]);

    const reloadedState = decodeStoryboardProjectState(
      encodeStoryboardProjectState(first.state),
    ).state;
    const reorderedRecords = (
      JSON.parse(JSON.stringify(records)) as FlashBoardActiveGenerationRecord[]
    ).map((entry) => ({
        ...entry,
        outputs: entry.outputs?.toReversed(),
        results: entry.results?.toReversed(),
      }));
    const second = reconcileStoryboardGenerationRecords(
      reloadedState,
      reorderedRecords.toReversed(),
    );

    expect(Object.keys(second.state.candidates).toSorted()).toEqual(
      Object.keys(first.state.candidates).toSorted(),
    );
    expect(Object.values(second.state.candidates).map((entry) => ({
      id: entry.id,
      generationRecordId: entry.generationRecordId,
      outputId: entry.outputId,
      mediaFileId: entry.mediaFileId,
      state: entry.state,
    })).toSorted((left, right) => left.id.localeCompare(right.id))).toEqual(
      Object.values(first.state.candidates).map((entry) => ({
        id: entry.id,
        generationRecordId: entry.generationRecordId,
        outputId: entry.outputId,
        mediaFileId: entry.mediaFileId,
        state: entry.state,
      })).toSorted((left, right) => left.id.localeCompare(right.id)),
    );

    for (let recordIndex = 0; recordIndex < recordCount; recordIndex += 1) {
      const prepared = second.state.candidates[
        `prepared-output-stress-${recordIndex}`
      ];
      expect(prepared).toMatchObject({
        generationRecordId: `record-output-stress-${recordIndex}`,
        outputId: `output-${recordIndex}-0`,
        mediaFileId: `media-${recordIndex}-0`,
        state: 'ready',
      });
      expect(second.state.candidates[createGenerationCandidateId(
        `record-output-stress-${recordIndex}`,
        { outputId: `output-${recordIndex}-1` },
      )]).toMatchObject({
        generationRecordId: `record-output-stress-${recordIndex}`,
        outputId: `output-${recordIndex}-1`,
        state: 'failed',
      });
      expect(reorderedRecords.find(
        (entry) => entry.id === `record-output-stress-${recordIndex}`,
      )?.outputs?.find(
        (output) => output.id === `output-${recordIndex}-1`,
      )).toMatchObject({
        importStatus: 'failed',
        importError: `terminal import failure ${recordIndex}:1`,
      });
    }
  });
});
