import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  approvePreparedStoryboardGeneration,
  prepareStoryboardGeneration,
  submitPreparedStoryboardGeneration,
} from '../../src/services/storyboard/generation';

const quote = {
  amount: 10,
  exact: true as const,
  pricingVersion: 'approval-price-v1',
  unit: 'hosted-credit' as const,
};

function brief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-approval',
    sceneId: 'scene-approval',
    revision: 2,
    prompt: 'A locked-off portrait.',
    durationSeconds: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

function catalog(): CatalogEntry[] {
  return [{
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
}

function projectState(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      'plan-1': {
        schemaVersion: 1,
        id: 'plan-1',
        title: 'Plan',
        sceneIds: ['scene-approval'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-approval': {
        schemaVersion: 1,
        id: 'scene-approval',
        planId: 'plan-1',
        title: 'Scene',
        description: 'Description',
        targetDurationSeconds: 5,
        status: 'ready',
        generationBriefId: 'brief-approval',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: { 'brief-approval': brief() },
    candidates: {},
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

async function prepare() {
  return prepareStoryboardGeneration({
    availability: { hostedAvailable: true },
    brief: brief(),
    candidateCount: 2,
    catalogEntries: catalog(),
    now: 100,
    pricingPort: () => quote,
    projectId: 'project-approval',
    userId: 'user-approval',
  });
}

async function approval(now = 100) {
  const prepared = await prepare();
  const approved = await approvePreparedStoryboardGeneration(prepared, {
    explicitUserApproval: true,
    expiresInMs: 1000,
    maxSpend: 20,
    now,
    priceUnit: 'hosted-credit',
    projectId: 'project-approval',
    userId: 'user-approval',
  });
  return { approved, prepared };
}

const noSubmitPorts = {
  createRecord: vi.fn(() => {
    throw new Error('must not create');
  }),
  listRecords: vi.fn(() => []),
  startRecord: vi.fn(() => {
    throw new Error('must not start');
  }),
};

describe('storyboard generation approval token', () => {
  it('requires an explicit approval gesture and binds max spend', async () => {
    const prepared = await prepare();
    await expect(approvePreparedStoryboardGeneration(prepared, {
      explicitUserApproval: false,
      maxSpend: 20,
      priceUnit: 'hosted-credit',
      projectId: 'project-approval',
      userId: 'user-approval',
    } as never)).rejects.toThrow(/explicit user approval/i);
    await expect(approvePreparedStoryboardGeneration(prepared, {
      explicitUserApproval: true,
      maxSpend: 19,
      priceUnit: 'hosted-credit',
      projectId: 'project-approval',
      userId: 'user-approval',
    })).rejects.toThrow(/maxSpend/i);
  });

  it('expires without reaching FlashBoard submission', async () => {
    const { approved, prepared } = await approval();
    await expect(submitPreparedStoryboardGeneration({
      now: 1100,
      ports: noSubmitPorts,
      prepared,
      pricingPort: () => quote,
      projectId: 'project-approval',
      state: projectState(),
      token: approved.token,
      userId: 'user-approval',
    })).rejects.toThrow(/expired/i);
    expect(noSubmitPorts.createRecord).not.toHaveBeenCalled();
    expect(noSubmitPorts.startRecord).not.toHaveBeenCalled();
  });

  it.each([
    ['request', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.entries[0].request.prompt = 'Changed prompt';
    }],
    ['count', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.candidateCount = 3;
    }],
    ['model', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.capability.version = 'different-model';
    }],
    ['provider', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.capability.providerId = 'different-provider';
    }],
    ['idempotency policy', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.capability.durableProviderIdempotency = !prepared.capability.durableProviderIdempotency;
    }],
    ['max spend', (prepared: Awaited<ReturnType<typeof prepare>>) => {
      prepared.quote.maximumSpend = 999;
    }],
  ])('rejects a %s change after approval', async (_label, mutate) => {
    const { approved, prepared } = await approval();
    mutate(prepared);
    await expect(submitPreparedStoryboardGeneration({
      now: 200,
      ports: noSubmitPorts,
      prepared,
      pricingPort: () => quote,
      projectId: 'project-approval',
      state: projectState(),
      token: approved.token,
      userId: 'user-approval',
    })).rejects.toThrow(/changed/i);
  });

  it('rejects a price amount or price-version change after approval', async () => {
    const { approved, prepared } = await approval();
    await expect(submitPreparedStoryboardGeneration({
      now: 200,
      ports: noSubmitPorts,
      prepared,
      pricingPort: () => ({ ...quote, amount: 11 }),
      projectId: 'project-approval',
      state: projectState(),
      token: approved.token,
      userId: 'user-approval',
    })).rejects.toThrow(/price changed/i);

    const second = await approval();
    await expect(submitPreparedStoryboardGeneration({
      now: 200,
      ports: noSubmitPorts,
      prepared: second.prepared,
      pricingPort: () => ({ ...quote, pricingVersion: 'approval-price-v2' }),
      projectId: 'project-approval',
      state: projectState(),
      token: second.approved.token,
      userId: 'user-approval',
    })).rejects.toThrow(/price changed/i);
  });

  it('binds the token to the approving user and project', async () => {
    const { approved, prepared } = await approval();
    await expect(submitPreparedStoryboardGeneration({
      now: 200,
      ports: noSubmitPorts,
      prepared,
      pricingPort: () => quote,
      projectId: 'other-project',
      state: projectState(),
      token: approved.token,
      userId: 'user-approval',
    })).rejects.toThrow(/user\/project/i);
  });
});
