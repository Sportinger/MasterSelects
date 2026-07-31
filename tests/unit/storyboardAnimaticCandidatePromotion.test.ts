import { describe, expect, it } from 'vitest';
import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  getStoryboardConceptPromotionRoles,
  promoteStoryboardConceptCandidate,
  removeStoryboardConceptPromotion,
  resolveStoryboardAnimaticMedia,
  type StoryboardConceptPromotionRole,
} from '../../src/services/storyboard/animaticCandidates';

function sourceBrief(): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: 'brief-scene:r1',
    sceneId: 'scene-concept',
    revision: 1,
    prompt: 'A lone figure waits under warm practical light.',
    negativePrompt: 'No text.',
    durationSeconds: 6,
    aspectRatio: '16:9',
    referenceMediaFileIds: ['look-reference'],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

function conceptCandidate(
  overrides: Partial<StoryboardCandidate> = {},
): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: 'candidate-concept',
    sceneId: 'scene-concept',
    kind: 'generated-image',
    state: 'ready',
    generationBriefRevision: 1,
    generationRequestKey: 'storyboard-generation:concept:0',
    generationRecordId: 'record-concept',
    outputId: 'output-concept',
    mediaFileId: 'media-concept',
    sourceMomentHandles: [],
    durationSeconds: 6,
    createdAt: 10,
    ...overrides,
  };
}

function projectState(
  candidate: StoryboardCandidate = conceptCandidate(),
): StoryboardProjectState {
  return {
    schemaVersion: 1,
    plans: {
      plan: {
        schemaVersion: 1,
        id: 'plan',
        title: 'Plan',
        sceneIds: ['scene-concept'],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: {
      'scene-concept': {
        schemaVersion: 1,
        id: 'scene-concept',
        planId: 'plan',
        title: 'Waiting',
        description: 'Hold on an expectant portrait.',
        targetDurationSeconds: 6,
        status: 'review',
        generationBriefId: 'brief-scene:r1',
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    },
    generationBriefs: { 'brief-scene:r1': sourceBrief() },
    candidates: { [candidate.id]: candidate },
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

describe('storyboard concept promotion', () => {
  it('never turns an unpromoted concept into a start frame or animatic image', () => {
    const state = projectState();
    expect(getStoryboardConceptPromotionRoles(state, 'candidate-concept')).toEqual([]);
    expect(state.generationBriefs['brief-scene:r1'].startFrameMediaFileId).toBeUndefined();
    expect(resolveStoryboardAnimaticMedia(state, 'scene-concept')).toMatchObject({
      kind: 'scene-slate',
      sceneId: 'scene-concept',
    });
  });

  it.each([
    'visual-reference',
    'start-frame',
    'end-frame',
    'card-thumbnail-and-generation-reference',
  ] satisfies StoryboardConceptPromotionRole[])(
    'persists only the explicit %s role through reload',
    (role) => {
      const initial = projectState();
      const promoted = promoteStoryboardConceptCandidate({
        candidateId: 'candidate-concept',
        createdAt: 20,
        expectedBriefRevision: 1,
        role,
        state: initial,
      });
      const reloaded = JSON.parse(JSON.stringify(promoted.state)) as StoryboardProjectState;
      const latest = reloaded.generationBriefs[promoted.createdBriefId];

      expect(promoted.createdBriefRevision).toBe(2);
      expect(getStoryboardConceptPromotionRoles(reloaded, 'candidate-concept'))
        .toEqual([role]);
      expect(latest.prompt).toBe(sourceBrief().prompt);
      expect(latest.referenceMediaFileIds).toContain('look-reference');
      expect(initial.generationBriefs['brief-scene:r1']).toEqual(sourceBrief());

      if (role === 'start-frame') {
        expect(latest.startFrameMediaFileId).toBe('media-concept');
        expect(latest.endFrameMediaFileId).toBeUndefined();
      } else if (role === 'end-frame') {
        expect(latest.endFrameMediaFileId).toBe('media-concept');
        expect(latest.startFrameMediaFileId).toBeUndefined();
      } else {
        expect(latest.referenceMediaFileIds).toContain('media-concept');
        expect(latest.startFrameMediaFileId).toBeUndefined();
      }
      expect(reloaded.scenes['scene-concept'].selectedCandidateId)
        .toBe(role === 'card-thumbnail-and-generation-reference'
          ? 'candidate-concept'
          : undefined);
    },
  );

  it('switches roles exclusively and removes promotion through new brief revisions', () => {
    const started = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'start-frame',
      state: projectState(),
    });
    const ended = promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 30,
      expectedBriefRevision: 2,
      role: 'end-frame',
      state: started.state,
    });
    expect(getStoryboardConceptPromotionRoles(ended.state, 'candidate-concept'))
      .toEqual(['end-frame']);
    expect(ended.state.generationBriefs[ended.createdBriefId].startFrameMediaFileId)
      .toBeUndefined();

    const removed = removeStoryboardConceptPromotion({
      candidateId: 'candidate-concept',
      createdAt: 40,
      expectedBriefRevision: 3,
      state: ended.state,
    });
    expect(getStoryboardConceptPromotionRoles(removed.state, 'candidate-concept'))
      .toEqual([]);
    expect(removed.createdBriefRevision).toBe(4);
  });

  it('rejects non-image and non-ready promotion attempts', () => {
    expect(() => promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'visual-reference',
      state: projectState(conceptCandidate({ state: 'processing' })),
    })).toThrow(/ready/i);
    expect(() => promoteStoryboardConceptCandidate({
      candidateId: 'candidate-concept',
      createdAt: 20,
      role: 'visual-reference',
      state: projectState(conceptCandidate({ kind: 'generated-video' })),
    })).toThrow(/generated-image/i);
  });
});
