import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import type {
  FlashBoardActiveGenerationRecord,
  FlashBoardGenerationRequest,
} from '../../src/stores/flashboardStore/types';
import {
  approvePreparedStoryboardGeneration,
  prepareStoryboardGeneration,
  submitPreparedStoryboardGeneration,
} from '../../src/services/storyboard/generation';

const exactQuote = {
  amount: 7,
  exact: true as const,
  pricingVersion: 'submission-price-v1',
  unit: 'hosted-credit' as const,
};

function brief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-submit',
    sceneId: 'scene-submit',
    revision: 1,
    prompt: 'A slow dolly forward.',
    durationSeconds: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

const catalog: CatalogEntry[] = [{
  service: 'cloud',
  providerId: 'cloud-kling',
  name: 'Hosted Kling',
  description: 'Exact hosted route',
  versions: ['latest'],
  modes: ['std'],
  durations: [5],
  aspectRatios: ['16:9'],
  supportsTextToVideo: true,
  supportsImageToVideo: true,
  supportsGenerateAudio: true,
  outputType: 'video',
}];

function state(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-submit'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-submit': {
        schemaVersion: 1,
        id: 'scene-submit',
        planId: 'plan',
        title: 'Scene',
        description: 'Description',
        targetDurationSeconds: 5,
        status: 'ready',
        generationBriefId: 'brief-submit',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: { 'brief-submit': brief() },
    candidates: {},
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

async function approvedBatch(candidateCount = 3) {
  const prepared = await prepareStoryboardGeneration({
    availability: { hostedAvailable: true },
    brief: brief(),
    candidateCount,
    catalogEntries: catalog,
    now: 10,
    pricingPort: () => exactQuote,
    projectId: 'project-submit',
    userId: 'user-submit',
  });
  const approval = await approvePreparedStoryboardGeneration(prepared, {
    explicitUserApproval: true,
    maxSpend: exactQuote.amount * candidateCount,
    now: 10,
    priceUnit: exactQuote.unit,
    projectId: 'project-submit',
    userId: 'user-submit',
  });
  return { approval, prepared };
}

function recordFor(
  request: FlashBoardGenerationRequest,
  index: number,
): FlashBoardActiveGenerationRecord {
  return {
    id: `record-${index}`,
    kind: 'generation',
    createdAt: 20 + index,
    updatedAt: 20 + index,
    request,
    job: { status: 'draft' },
  };
}

describe('storyboard generation idempotent submission', () => {
  it('coalesces concurrent calls and reuses records on retry', async () => {
    const { approval, prepared } = await approvedBatch();
    const records: FlashBoardActiveGenerationRecord[] = [];
    const persistedStates: StoryboardProjectState[] = [];
    const createRecord = vi.fn((request: FlashBoardGenerationRequest) => {
      const record = recordFor(request, records.length);
      records.push(record);
      return record;
    });
    const startRecord = vi.fn((recordId: string) => {
      const record = records.find((item) => item.id === recordId)!;
      const preparedEntry = prepared.entries.find(
        (entry) => entry.generationRequestKey === record.request?.idempotencyKey,
      )!;
      expect(persistedStates.at(-1)?.candidates[preparedEntry.candidate.id])
        .toMatchObject({ generationRecordId: recordId });
      record.job = { status: 'queued' };
      return record;
    });
    const input = {
      now: 20,
      ports: {
        createRecord,
        listRecords: () => records,
        persistState: (projectState: StoryboardProjectState) => {
          persistedStates.push(projectState);
        },
        startRecord,
      },
      prepared,
      pricingPort: () => exactQuote,
      projectId: 'project-submit',
      state: state(),
      token: approval.token,
      userId: 'user-submit',
    };

    const firstPromise = submitPreparedStoryboardGeneration(input);
    const concurrentPromise = submitPreparedStoryboardGeneration(input);
    expect(concurrentPromise).toBe(firstPromise);
    const [first, concurrent] = await Promise.all([firstPromise, concurrentPromise]);

    expect(first).toEqual(concurrent);
    expect(first.status).toBe('submitted');
    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(startRecord).toHaveBeenCalledTimes(3);
    expect(records.map((record) => record.request?.idempotencyKey))
      .toEqual(prepared.entries.map((entry) => entry.generationRequestKey));
    expect(first.entries.every((entry) => entry.recordId)).toBe(true);

    const retried = await submitPreparedStoryboardGeneration({
      ...input,
      state: first.state,
    });
    expect(retried.entries.every((entry) => entry.status === 'reused')).toBe(true);
    expect(createRecord).toHaveBeenCalledTimes(3);
    expect(startRecord).toHaveBeenCalledTimes(3);
  });

  it('keeps successful partial mappings and safely retries only the missing entry', async () => {
    const { approval, prepared } = await approvedBatch();
    const records: FlashBoardActiveGenerationRecord[] = [];
    let failMiddle = true;
    const createRecord = vi.fn((request: FlashBoardGenerationRequest) => {
      const index = prepared.entries.findIndex(
        (entry) => entry.generationRequestKey === request.idempotencyKey,
      );
      if (index === 1 && failMiddle) throw new Error('temporary transport failure');
      const record = recordFor(request, index);
      records.push(record);
      return record;
    });
    const startRecord = vi.fn((recordId: string) => {
      const item = records.find((record) => record.id === recordId)!;
      item.job = { status: 'queued' };
      return item;
    });
    const ports = {
      createRecord,
      listRecords: () => records,
      startRecord,
    };

    const first = await submitPreparedStoryboardGeneration({
      now: 20,
      ports,
      prepared,
      pricingPort: () => exactQuote,
      projectId: 'project-submit',
      state: state(),
      token: approval.token,
      userId: 'user-submit',
    });
    expect(first.status).toBe('partial');
    expect(first.entries.map((entry) => entry.status)).toEqual([
      'submitted',
      'failed',
      'submitted',
    ]);
    expect(records).toHaveLength(2);

    failMiddle = false;
    const retried = await submitPreparedStoryboardGeneration({
      now: 21,
      ports,
      prepared,
      pricingPort: () => exactQuote,
      projectId: 'project-submit',
      state: first.state,
      token: approval.token,
      userId: 'user-submit',
    });
    expect(retried.status).toBe('submitted');
    expect(retried.entries.map((entry) => entry.status)).toEqual([
      'reused',
      'submitted',
      'reused',
    ]);
    expect(records).toHaveLength(3);
    expect(Object.values(retried.state.candidates).every(
      (candidate) => candidate.generationRecordId,
    )).toBe(true);
  });
});
