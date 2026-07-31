import { describe, expect, it } from 'vitest';
import {
  decodeStoryboardProjectState,
  encodeStoryboardProjectState,
} from '../../src/services/project/storyboard';
import {
  getStoryboardConceptPromotionRoles,
  linkStoryboardAnimaticNarrationCandidate,
  promoteStoryboardConceptCandidate,
  resolveStoryboardAnimaticMedia,
  resolveStoryboardAnimaticNarration,
  type StoryboardConceptPromotionRole,
} from '../../src/services/storyboard/animaticCandidates';
import type {
  StoryboardCandidate,
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../../src/services/storyboard/contracts';
import {
  selectLatestStoryboardGenerationBrief,
} from '../../src/services/storyboard/generation';

const sceneCount = 30;

function sceneId(index: number): string {
  return `scene-generation-linkage-${index}`;
}

function briefId(index: number): string {
  return `brief-generation-linkage-${index}:r1`;
}

function conceptId(index: number): string {
  return `candidate-generation-concept-${index}`;
}

function narrationId(index: number): string {
  return `candidate-generation-narration-${index}`;
}

function brief(index: number): StoryboardGenerationBrief {
  return {
    schemaVersion: 1,
    id: briefId(index),
    sceneId: sceneId(index),
    revision: 1,
    prompt: `Original prompt for scene ${index}.`,
    negativePrompt: `Original negative prompt ${index}.`,
    durationSeconds: 5 + index % 3,
    aspectRatio: '16:9',
    referenceMediaFileIds: [`original-reference-${index}`],
    capabilityPolicy: { mediaType: 'video' },
    createdAt: 1,
  };
}

function concept(index: number): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: conceptId(index),
    sceneId: sceneId(index),
    kind: 'generated-image',
    state: 'ready',
    generationBriefRevision: 1,
    generationRequestKey: `storyboard-generation:concept-linkage:${index}`,
    generationRecordId: `record-generation-concept-${index}`,
    outputId: `output-generation-concept-${index}`,
    mediaFileId: `media-generation-concept-${index}`,
    sourceMomentHandles: [],
    durationSeconds: 5 + index % 3,
    createdAt: 10 + index,
  };
}

function narration(index: number): StoryboardCandidate {
  return {
    schemaVersion: 1,
    id: narrationId(index),
    sceneId: sceneId(index),
    kind: 'generated-audio',
    state: index % 2 === 0 ? 'ready' : 'processing',
    generationBriefRevision: 1,
    generationRequestKey: `storyboard-generation:narration-linkage:${index}`,
    generationRecordId: `record-generation-narration-${index}`,
    outputId: `output-generation-narration-${index}`,
    ...(index % 2 === 0
      ? { mediaFileId: `media-generation-narration-${index}` }
      : {}),
    sourceMomentHandles: [],
    durationSeconds: 5.5 + index % 3,
    rationale: `Narration note ${index}.`,
    createdAt: 50 + index,
  };
}

function initialState(): StoryboardProjectState {
  const sceneIds = Array.from({ length: sceneCount }, (_, index) => sceneId(index));
  const briefs = Array.from({ length: sceneCount }, (_, index) => brief(index));
  const candidates = Array.from(
    { length: sceneCount },
    (_, index) => [concept(index), narration(index)],
  ).flat();
  return {
    schemaVersion: 1,
    plans: {
      'plan-generation-linkage': {
        schemaVersion: 1,
        id: 'plan-generation-linkage',
        title: 'Generation linkage',
        sceneIds,
        createdAt: 1,
        updatedAt: 1,
      },
    },
    scenes: Object.fromEntries(sceneIds.map((id, index) => [
      id,
      {
        schemaVersion: 1 as const,
        id,
        planId: 'plan-generation-linkage',
        title: `Scene ${index}`,
        description: `Original scene description ${index}.`,
        targetDurationSeconds: 5 + index % 3,
        status: 'review' as const,
        generationBriefId: briefId(index),
        filledClipIds: [],
        evidenceRefIds: [],
        variantSetIds: [],
        createdAt: 1,
        updatedAt: 1,
      },
    ])),
    generationBriefs: Object.fromEntries(
      briefs.map((entry) => [entry.id, entry]),
    ),
    candidates: Object.fromEntries(
      candidates.map((entry) => [entry.id, entry]),
    ),
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

function expectedRole(index: number): StoryboardConceptPromotionRole | null {
  if (index % 3 === 0) return 'card-thumbnail-and-generation-reference';
  if (index % 3 === 1) return 'start-frame';
  return null;
}

describe('storyboard generation provenance reload stress', () => {
  it('preserves explicit concept roles and narration job provenance for many scenes', () => {
    let current = initialState();
    for (let index = 0; index < sceneCount; index += 1) {
      current = linkStoryboardAnimaticNarrationCandidate(
        current,
        narrationId(index),
      );
      const role = expectedRole(index);
      if (role) {
        current = promoteStoryboardConceptCandidate({
          candidateId: conceptId(index),
          createdAt: 100 + index,
          role,
          state: current,
        }).state;
      }
      current = {
        ...current,
        scenes: {
          ...current.scenes,
          [sceneId(index)]: {
            ...current.scenes[sceneId(index)],
            title: `Later edited scene ${index}`,
            description: `Later edited description ${index}.`,
            updatedAt: 200 + index,
          },
        },
      };
    }

    const reloaded = decodeStoryboardProjectState(
      encodeStoryboardProjectState(current),
    ).state;

    for (let index = 0; index < sceneCount; index += 1) {
      const role = expectedRole(index);
      expect(getStoryboardConceptPromotionRoles(reloaded, conceptId(index)))
        .toEqual(role ? [role] : []);
      const latestBrief = selectLatestStoryboardGenerationBrief(
        reloaded,
        sceneId(index),
      )!;

      if (role === 'start-frame') {
        expect(latestBrief.startFrameMediaFileId)
          .toBe(`media-generation-concept-${index}`);
      } else {
        expect(latestBrief.startFrameMediaFileId).toBeUndefined();
      }

      const media = resolveStoryboardAnimaticMedia(reloaded, sceneId(index));
      if (role === 'card-thumbnail-and-generation-reference') {
        expect(media).toMatchObject({
          kind: 'concept-image',
          candidateId: conceptId(index),
          mediaFileId: `media-generation-concept-${index}`,
          provenance: {
            sourceBriefId: briefId(index),
            prompt: `Original prompt for scene ${index}.`,
            negativePrompt: `Original negative prompt ${index}.`,
            referenceMediaFileIds: [`original-reference-${index}`],
            generationRecordId: `record-generation-concept-${index}`,
            outputId: `output-generation-concept-${index}`,
          },
        });
      } else {
        expect(media).toMatchObject({
          kind: 'scene-slate',
          sceneId: sceneId(index),
          title: `Later edited scene ${index}`,
        });
      }

      expect(resolveStoryboardAnimaticNarration(
        reloaded,
        sceneId(index),
      )).toMatchObject({
        candidateId: narrationId(index),
        generationRecordId: `record-generation-narration-${index}`,
        generationRequestKey:
          `storyboard-generation:narration-linkage:${index}`,
        provenance: {
          sourceBriefId: briefId(index),
          prompt: `Original prompt for scene ${index}.`,
          negativePrompt: `Original negative prompt ${index}.`,
          referenceMediaFileIds: [`original-reference-${index}`],
          generationRecordId: `record-generation-narration-${index}`,
          outputId: `output-generation-narration-${index}`,
        },
      });
    }
  });
});
