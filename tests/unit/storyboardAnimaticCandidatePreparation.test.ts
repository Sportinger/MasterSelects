import { describe, expect, it, vi } from 'vitest';
import type { CatalogEntry } from '../../src/services/flashboard/types';
import type { StoryboardProjectState } from '../../src/services/storyboard/contracts';
import {
  prepareStoryboardConceptImage,
} from '../../src/services/storyboard/animaticCandidates';

const nanoBananaCatalog: CatalogEntry[] = [{
  service: 'cloud',
  providerId: 'nano-banana-2',
  name: 'Nano Banana 2',
  description: 'Hosted storyboard concept image',
  versions: ['latest'],
  modes: [],
  durations: [],
  aspectRatios: ['16:9'],
  referenceInputKinds: ['image-reference'],
  supportsTextToVideo: false,
  supportsImageToVideo: false,
  supportsTextToImage: true,
  imageSizes: ['1K', '2K'],
  maxReferenceImages: 4,
  outputType: 'image',
}];

function state(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-image'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-image': {
        schemaVersion: 1,
        id: 'scene-image',
        planId: 'plan',
        title: 'Portrait',
        description: 'A visual concept.',
        targetDurationSeconds: 5,
        status: 'ready',
        generationBriefId: 'brief-image:r1',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {
      'brief-image:r1': {
        schemaVersion: 1,
        id: 'brief-image:r1',
        sceneId: 'scene-image',
        revision: 1,
        prompt: 'A close portrait in a dim workshop.',
        visualContinuity: 'Muted amber and steel-blue palette.',
        durationSeconds: 5,
        aspectRatio: '16:9',
        referenceMediaFileIds: ['look-ref'],
        startFrameMediaFileId: 'previous-start',
        capabilityPolicy: { mediaType: 'video' },
        createdAt: 1,
      },
    },
    candidates: {},
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

describe('storyboard concept preparation over WP5', () => {
  it('derives a read-only image batch with reload-safe prompt/reference request data', async () => {
    const original = state();
    const before = JSON.stringify(original);
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const prepared = await prepareStoryboardConceptImage({
      availability: { hostedAvailable: true },
      candidateCount: 2,
      catalogEntries: nanoBananaCatalog,
      imageSize: '1K',
      now: 100,
      pricingPort: () => ({
        amount: 48,
        exact: true,
        pricingVersion: 'concept-price-v1',
        unit: 'hosted-credit',
      }),
      projectId: 'project-image',
      referenceMediaTypes: { 'look-ref': 'image' },
      sceneId: 'scene-image',
      state: original,
      userId: 'user-image',
    });

    expect(JSON.stringify(original)).toBe(before);
    expect(prepared.capability).toMatchObject({
      outputType: 'image',
      providerId: 'nano-banana-2',
      route: 'hosted',
      submissionSupported: true,
    });
    expect(prepared.quote.total).toBe(96);
    expect(prepared.entries).toHaveLength(2);
    expect(prepared.entries.every(
      (entry) => entry.candidate.kind === 'generated-image'
        && entry.candidate.state === 'awaiting-approval',
    )).toBe(true);
    expect(prepared.entries[0].request).toMatchObject({
      outputType: 'image',
      prompt: expect.stringContaining('A close portrait in a dim workshop.'),
      referenceMediaFileIds: ['look-ref', 'previous-start'],
    });
    expect(prepared.entries[0].request.startMediaFileId).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('fails closed when no exact supported concept-image capability exists', async () => {
    await expect(prepareStoryboardConceptImage({
      availability: { hostedAvailable: false },
      candidateCount: 1,
      catalogEntries: nanoBananaCatalog,
      projectId: 'project-image',
      referenceMediaTypes: { 'look-ref': 'image' },
      sceneId: 'scene-image',
      state: state(),
      userId: 'user-image',
    })).rejects.toThrow(/compatible generation capability/i);
  });
});
