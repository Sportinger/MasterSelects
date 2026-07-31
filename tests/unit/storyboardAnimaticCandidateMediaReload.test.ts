import { describe, expect, it } from 'vitest';
import {
  createStoryboardGenerationBriefRevision,
} from '../../src/services/storyboard/generation';
import type {
  StoryboardCandidate,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  linkStoryboardAnimaticNarrationCandidate,
  promoteStoryboardConceptCandidate,
  resolveStoryboardCandidateAnimaticFramePayload,
  resolveStoryboardAnimaticMedia,
  resolveStoryboardAnimaticNarration,
  unlinkStoryboardAnimaticNarrationCandidate,
} from '../../src/services/storyboard/animaticCandidates';

function candidate(
  overrides: Partial<StoryboardCandidate>,
): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: 'candidate-concept',
    sceneId: 'scene-media',
    kind: 'generated-image',
    state: 'ready',
    generationBriefRevision: 1,
    generationRequestKey: 'storyboard-generation:media:0',
    generationRecordId: 'record-media',
    outputId: 'output-media',
    mediaFileId: 'media-concept',
    sourceMomentHandles: [],
    durationSeconds: 8,
    createdAt: 10,
    ...overrides,
  };
}

function state(): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-media'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-media': {
        schemaVersion: 1,
        id: 'scene-media',
        planId: 'plan',
        title: 'Arrival',
        description: 'The subject reaches the door.',
        targetDurationSeconds: 8,
        status: 'review',
        generationBriefId: 'brief-media:r1',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: {
      'brief-media:r1': {
        schemaVersion: 1,
        id: 'brief-media:r1',
        sceneId: 'scene-media',
        revision: 1,
        prompt: 'Original prompt with a slow approach.',
        negativePrompt: 'No title cards.',
        durationSeconds: 8,
        aspectRatio: '16:9',
        referenceMediaFileIds: ['original-look'],
        capabilityPolicy: { mediaType: 'video' },
        createdAt: 1,
      },
    },
    candidates: {
      'candidate-concept': candidate({}),
    },
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

describe('storyboard candidate-backed animatic media and narration reload', () => {
  it('uses only an explicitly promoted concept and keeps its original prompt provenance', () => {
    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: state(),
    });
    const later = createStoryboardGenerationBriefRevision(promoted.state, {
      prompt: 'Later replacement prompt.',
      negativePrompt: 'Different negative prompt.',
      durationSeconds: 8,
      aspectRatio: '16:9',
      referenceMediaFileIds: ['original-look', 'media-concept', 'different-reference'],
      capabilityPolicy: { mediaType: 'video' },
      createdAt: 30,
      expectedPreviousRevision: 2,
      sceneId: 'scene-media',
    }).state;
    const reloaded = JSON.parse(JSON.stringify(later)) as StoryboardProjectState;
    const resolved = resolveStoryboardAnimaticMedia(reloaded, 'scene-media', {
      cameraMove: 'pull-out',
    });

    expect(resolved).toMatchObject({
      kind: 'concept-image',
      candidateId: 'candidate-concept',
      mediaFileId: 'media-concept',
      promotionRoles: ['card-thumbnail-and-generation-reference'],
      provenance: {
        generationBriefRevision: 1,
        generationRecordId: 'record-media',
        generationRequestKey: 'storyboard-generation:media:0',
        prompt: 'Original prompt with a slow approach.',
        negativePrompt: 'No title cards.',
        referenceMediaFileIds: ['original-look'],
        sourceBriefId: 'brief-media:r1',
      },
    });
  });

  it('prioritizes accepted candidate video over a promoted concept image', () => {
    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: state(),
    }).state;
    const video = candidate({
      id: 'candidate-video',
      kind: 'generated-video',
      state: 'accepted',
      generationRequestKey: 'storyboard-generation:video:0',
      generationRecordId: 'record-video',
      mediaFileId: 'media-video',
      createdAt: 30,
    });
    const withVideo = {
      ...promoted,
      candidates: {
        ...promoted.candidates,
        [video.id]: video,
      },
    };
    expect(resolveStoryboardAnimaticMedia(withVideo, 'scene-media')).toMatchObject({
      kind: 'candidate-video',
      candidateId: 'candidate-video',
      mediaFileId: 'media-video',
    });
    expect(resolveStoryboardCandidateAnimaticFramePayload({
      height: 1080,
      mediaFiles: [],
      mode: 'animatic-export',
      sceneClipId: 'scene-clip-media',
      sceneId: 'scene-media',
      startTime: 4,
      state: withVideo,
      time: 7,
      width: 1920,
    })).toMatchObject({
      kind: 'real-media',
      sceneId: 'scene-media',
      sceneClipId: 'scene-clip-media',
      startTime: 4,
      endTime: 12,
      localTime: 3,
      progress: 0.375,
    });
  });

  it('adapts a promoted concept into preview/export still payloads but never normal export', () => {
    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: state(),
    }).state;
    const input = {
      height: 1080,
      mediaFiles: [{
        id: 'media-concept',
        name: 'Concept',
        type: 'image' as const,
        parentId: null,
        createdAt: 20,
        url: 'blob:concept',
      }],
      sceneClipId: 'scene-clip-media',
      sceneId: 'scene-media',
      startTime: 4,
      state: promoted,
      time: 8,
      watermark: 'ANIMATIC',
      width: 1920,
    };

    const preview = resolveStoryboardCandidateAnimaticFramePayload({
      ...input,
      mode: 'preview',
    });
    const animaticExport = resolveStoryboardCandidateAnimaticFramePayload({
      ...input,
      mode: 'animatic-export',
    });

    expect(preview).toMatchObject({
      kind: 'still-image',
      mode: 'preview',
      durationSeconds: 8,
      progress: 0.5,
      watermark: 'ANIMATIC',
      still: {
        clipId: 'storyboard-animatic-candidate:candidate-concept',
        mediaFileId: 'media-concept',
        imageUrl: 'blob:concept',
        cameraMove: 'push-in',
      },
    });
    expect(preview?.still?.scale).toBeGreaterThan(1);
    expect(animaticExport).toEqual({
      ...preview,
      mode: 'animatic-export',
    });
    expect(resolveStoryboardCandidateAnimaticFramePayload({
      ...input,
      mode: 'normal-export',
    })).toBeNull();
  });

  it('falls back to a scene slate when a promoted concept asset is unavailable', () => {
    const promoted = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'card-thumbnail-and-generation-reference',
      state: state(),
    }).state;
    expect(resolveStoryboardCandidateAnimaticFramePayload({
      height: 720,
      mediaFiles: [],
      mode: 'preview',
      sceneClipId: 'scene-clip-media',
      sceneId: 'scene-media',
      startTime: 0,
      state: promoted,
      time: 2,
      width: 1280,
    })).toMatchObject({
      kind: 'slate',
      slate: {
        title: 'Arrival',
        description: 'The subject reaches the door.',
        status: 'review',
        targetDurationSeconds: 8,
      },
    });
  });

  it('links one narration job explicitly and restores duration/provenance after JSON reload', () => {
    const firstNarration = candidate({
      id: 'narration-1',
      kind: 'generated-audio',
      state: 'ready',
      generationRequestKey: 'storyboard-generation:narration:0',
      generationRecordId: 'record-narration-1',
      outputId: 'output-narration-1',
      mediaFileId: 'media-narration-1',
      durationSeconds: 9.5,
      rationale: 'Warm temporary read.',
      createdAt: 40,
    });
    const secondNarration = candidate({
      id: 'narration-2',
      kind: 'generated-audio',
      state: 'processing',
      generationRequestKey: 'storyboard-generation:narration:1',
      generationRecordId: 'record-narration-2',
      mediaFileId: undefined,
      durationSeconds: undefined,
      createdAt: 50,
    });
    let linked: StoryboardProjectState = {
      ...state(),
      candidates: {
        ...state().candidates,
        [firstNarration.id]: firstNarration,
        [secondNarration.id]: secondNarration,
      },
    };
    linked = linkStoryboardAnimaticNarrationCandidate(linked, firstNarration.id);
    const reloaded = JSON.parse(JSON.stringify(linked)) as StoryboardProjectState;

    expect(resolveStoryboardAnimaticNarration(reloaded, 'scene-media')).toMatchObject({
      candidateId: 'narration-1',
      generationRecordId: 'record-narration-1',
      generationRequestKey: 'storyboard-generation:narration:0',
      mediaFileId: 'media-narration-1',
      durationSeconds: 9.5,
      targetDurationSeconds: 8,
      durationDeltaSeconds: 1.5,
      provenance: {
        prompt: 'Original prompt with a slow approach.',
        referenceMediaFileIds: ['original-look'],
      },
    });

    linked = linkStoryboardAnimaticNarrationCandidate(reloaded, secondNarration.id);
    expect(resolveStoryboardAnimaticNarration(linked, 'scene-media')).toMatchObject({
      candidateId: 'narration-2',
      state: 'processing',
      generationRecordId: 'record-narration-2',
    });
    expect(linked.candidates['narration-1'].rationale).toBe('Warm temporary read.');

    const unlinked = unlinkStoryboardAnimaticNarrationCandidate(linked, secondNarration.id);
    expect(resolveStoryboardAnimaticNarration(unlinked, 'scene-media')).toBeNull();
  });

  it('rejects narration candidates without durable job linkage', () => {
    const unlinked = candidate({
      id: 'narration-unlinked',
      kind: 'generated-audio',
      generationRecordId: undefined,
      generationRequestKey: undefined,
    });
    const current = state();
    current.candidates[unlinked.id] = unlinked;
    expect(() => linkStoryboardAnimaticNarrationCandidate(
      current,
      unlinked.id,
    )).toThrow(/generation record and request linkage/i);
  });
});
