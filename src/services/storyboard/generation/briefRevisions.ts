import type {
  StoryboardGenerationBrief,
  StoryboardProjectState,
} from '../contracts';
import { assertStoryboardGenerationBrief } from '../contracts';

export type StoryboardGenerationBriefRevisionValues = Omit<
  StoryboardGenerationBrief,
  'createdAt' | 'id' | 'revision' | 'sceneId' | 'schemaVersion'
>;

export interface CreateStoryboardGenerationBriefRevisionInput
  extends StoryboardGenerationBriefRevisionValues {
  createdAt: number;
  expectedPreviousRevision?: number;
  id?: string;
  sceneId: string;
}

export interface CreateStoryboardGenerationBriefRevisionResult {
  brief: StoryboardGenerationBrief;
  state: StoryboardProjectState;
}

function compareStableStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function encodeBriefIdentity(value: string): string {
  return encodeURIComponent(value);
}

export function createStoryboardGenerationBriefId(
  sceneId: string,
  revision: number,
): string {
  return `storyboard-brief:${encodeBriefIdentity(sceneId)}:r${revision}`;
}

export function selectStoryboardGenerationBriefRevisions(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardGenerationBrief[] {
  return Object.values(state.generationBriefs)
    .filter((brief) => brief.sceneId === sceneId)
    .sort((left, right) => (
      left.revision - right.revision
      || left.createdAt - right.createdAt
      || compareStableStrings(left.id, right.id)
    ));
}

export function selectLatestStoryboardGenerationBrief(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardGenerationBrief | undefined {
  return selectStoryboardGenerationBriefRevisions(state, sceneId).at(-1);
}

export function createStoryboardGenerationBriefRevision(
  state: StoryboardProjectState,
  input: CreateStoryboardGenerationBriefRevisionInput,
): CreateStoryboardGenerationBriefRevisionResult {
  const scene = state.scenes[input.sceneId];
  if (!scene) throw new Error(`Unknown storyboard scene: ${input.sceneId}`);

  const previous = selectLatestStoryboardGenerationBrief(state, input.sceneId);
  const previousRevision = previous?.revision ?? 0;
  if (
    input.expectedPreviousRevision !== undefined
    && input.expectedPreviousRevision !== previousRevision
  ) {
    throw new Error(
      `Generation brief revision conflict for ${input.sceneId}: expected `
      + `${input.expectedPreviousRevision}, current ${previousRevision}`,
    );
  }

  const revision = previousRevision + 1;
  const id = input.id ?? createStoryboardGenerationBriefId(input.sceneId, revision);
  if (state.generationBriefs[id]) {
    throw new Error(`Generation brief identity already exists: ${id}`);
  }
  const brief: StoryboardGenerationBrief = {
    schemaVersion: 1,
    id,
    sceneId: input.sceneId,
    revision,
    prompt: input.prompt,
    durationSeconds: input.durationSeconds,
    aspectRatio: input.aspectRatio,
    referenceMediaFileIds: [...input.referenceMediaFileIds],
    capabilityPolicy: { ...input.capabilityPolicy },
    createdAt: input.createdAt,
  };
  if (input.negativePrompt) brief.negativePrompt = input.negativePrompt;
  if (input.visualContinuity) brief.visualContinuity = input.visualContinuity;
  if (input.camera) brief.camera = input.camera;
  if (input.motion) brief.motion = input.motion;
  if (input.lighting) brief.lighting = input.lighting;
  if (input.audioIntent) brief.audioIntent = input.audioIntent;
  if (input.startFrameMediaFileId) {
    brief.startFrameMediaFileId = input.startFrameMediaFileId;
  }
  if (input.endFrameMediaFileId) brief.endFrameMediaFileId = input.endFrameMediaFileId;
  assertStoryboardGenerationBrief(brief);

  return {
    brief,
    state: {
      ...state,
      generationBriefs: {
        ...state.generationBriefs,
        [brief.id]: brief,
      },
      scenes: {
        ...state.scenes,
        [scene.id]: {
          ...scene,
          generationBriefId: brief.id,
          updatedAt: Math.max(scene.updatedAt, input.createdAt),
        },
      },
    },
  };
}
