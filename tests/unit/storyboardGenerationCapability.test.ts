import { describe, expect, it, vi } from 'vitest';
import {
  getFlashBoardPriceQuote,
  FLASHBOARD_PRICING_VERSION,
} from '../../src/services/flashboard/FlashBoardPricing';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import type { StoryboardGenerationBrief } from '../../src/services/storyboard/contracts';
import {
  prepareStoryboardGeneration,
  resolveStoryboardGenerationCapabilities,
} from '../../src/services/storyboard/generation';

function brief(
  overrides: Partial<StoryboardGenerationBrief> = {},
): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-1',
    sceneId: 'scene-1',
    revision: 1,
    prompt: 'A person enters a quiet room.',
    durationSeconds: 5,
    aspectRatio: '16:9',
    referenceMediaFileIds: [],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
    ...overrides,
  };
}

function entry(
  overrides: Partial<CatalogEntry> = {},
): CatalogEntry {
  return {
    service: 'cloud',
    providerId: 'cloud-kling',
    name: 'Hosted Kling',
    description: 'Exact hosted video',
    versions: ['latest'],
    modes: ['std'],
    durations: [5],
    aspectRatios: ['16:9'],
    referenceInputKinds: [
      'start-frame',
      'end-frame',
      'image-reference',
      'video-reference',
    ],
    supportsTextToVideo: true,
    supportsImageToVideo: true,
    supportsGenerateAudio: true,
    maxReferenceMedia: 3,
    outputType: 'video',
    ...overrides,
  };
}

describe('storyboard generation capability and prepare gate', () => {
  it('resolves the actual provider route without silently falling back', () => {
    const capabilities = resolveStoryboardGenerationCapabilities({
      availability: {
        hostedAvailable: true,
      },
      brief: brief(),
      catalogEntries: [entry()],
    });

    expect(capabilities.map((capability) => ({
      providerId: capability.providerId,
      route: capability.route,
      service: capability.service,
      submissionSupported: capability.submissionSupported,
    }))).toEqual([
      {
        providerId: 'cloud-kling',
        route: 'hosted',
        service: 'cloud',
        submissionSupported: true,
      },
    ]);
  });

  it('checks duration, aspect ratio, start/end frames, references, and native audio', () => {
    const strictBrief = brief({
      startFrameMediaFileId: 'start',
      endFrameMediaFileId: 'end',
      referenceMediaFileIds: ['look'],
      capabilityPolicy: {
        mediaType: 'video',
        needsImageToVideo: true,
        needsStartEndFrames: true,
        needsNativeAudio: true,
      },
    });
    expect(resolveStoryboardGenerationCapabilities({
      availability: { hostedAvailable: true },
      brief: strictBrief,
      catalogEntries: [entry()],
      referenceMediaTypes: { look: 'image' },
    })).toHaveLength(1);

    expect(resolveStoryboardGenerationCapabilities({
      availability: { hostedAvailable: true },
      brief: strictBrief,
      catalogEntries: [entry({ supportsGenerateAudio: false })],
      referenceMediaTypes: { look: 'image' },
    })).toEqual([]);
    expect(resolveStoryboardGenerationCapabilities({
      availability: { hostedAvailable: true },
      brief: strictBrief,
      catalogEntries: [entry({ durations: [10] })],
      referenceMediaTypes: { look: 'image' },
    })).toEqual([]);
    expect(resolveStoryboardGenerationCapabilities({
      availability: { hostedAvailable: true },
      brief: strictBrief,
      catalogEntries: [entry({ aspectRatios: ['9:16'] })],
      referenceMediaTypes: { look: 'image' },
    })).toEqual([]);
  });

  it('keeps audio visible but fail-closed while durable response replay is unavailable', () => {
    const capabilities = resolveStoryboardGenerationCapabilities({
      availability: { hostedAvailable: true },
      brief: brief({
        capabilityPolicy: { mediaType: 'audio' },
        aspectRatio: '',
      }),
      catalogEntries: [entry({
        providerId: 'cloud-elevenlabs-tts',
        outputType: 'audio',
        supportsTextToVideo: false,
        supportsImageToVideo: false,
        supportsTextToAudio: true,
        durations: [],
        aspectRatios: [],
        modes: [],
      })],
    });
    expect(capabilities).toMatchObject([{
      route: 'hosted',
      submissionSupported: false,
      durableProviderIdempotency: false,
    }]);
  });

  it('prepares deterministic candidates and an exact numeric quote without records, fetch, or spend', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const pricingPort = vi.fn(() => ({
      amount: 10,
      exact: true as const,
      pricingVersion: 'test-price-v1',
      unit: 'hosted-credit' as const,
    }));
    const prepared = await prepareStoryboardGeneration({
      availability: { hostedAvailable: true },
      brief: brief(),
      candidateCount: 3,
      catalogEntries: [entry()],
      now: 100,
      pricingPort,
      projectId: 'project-1',
      userId: 'user-1',
    });

    expect(prepared.quote).toEqual({
      maximumSpend: 30,
      perRequest: {
        amount: 10,
        exact: true,
        pricingVersion: 'test-price-v1',
        unit: 'hosted-credit',
      },
      requestCount: 3,
      total: 30,
    });
    expect(prepared.entries).toHaveLength(3);
    expect(new Set(prepared.entries.map((item) => item.generationRequestKey)).size).toBe(3);
    expect(prepared.entries.every((item) => item.candidate.state === 'awaiting-approval')).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('publishes numeric versioned prices without parsing presentation labels', () => {
    expect(getFlashBoardPriceQuote({
      duration: 5,
      generateAudio: false,
      mode: 'std',
      outputType: 'video',
      providerId: 'cloud-kling',
      service: 'cloud',
    })).toEqual({
      amount: expect.any(Number),
      exact: true,
      pricingVersion: FLASHBOARD_PRICING_VERSION,
      unit: 'hosted-credit',
    });
    expect(getFlashBoardPriceQuote({
      outputType: 'image',
      providerId: 'unknown-image-provider',
      service: 'cloud',
    })).toBeNull();
  });
});
