import {
  assertStoryboardTemplate,
  cloneStoryboardProjectState,
  type StoryboardGenerationBrief,
  type StoryboardProjectState,
  type StoryboardTemplate,
} from '../contracts';
import { isBuiltInStoryboardTemplateId } from './builtInTemplates';
import type { CreateCustomStoryboardTemplateInput } from './types';
import { assertStoryboardTemplateSemantics } from './validation';

function latestBriefForScene(
  state: StoryboardProjectState,
  sceneId: string,
): StoryboardGenerationBrief | undefined {
  return Object.values(state.generationBriefs)
    .filter(brief => brief.sceneId === sceneId)
    .toSorted((left, right) =>
      right.revision - left.revision ||
      right.createdAt - left.createdAt ||
      right.id.localeCompare(left.id)
    )[0];
}

function generationDefaultsFromBrief(brief: StoryboardGenerationBrief | undefined) {
  if (!brief) return undefined;
  const {
    schemaVersion: _schemaVersion,
    id: _id,
    sceneId: _sceneId,
    revision: _revision,
    createdAt: _createdAt,
    durationSeconds: _durationSeconds,
    aspectRatio: _aspectRatio,
    referenceMediaFileIds: _referenceMediaFileIds,
    startFrameMediaFileId: _startFrameMediaFileId,
    endFrameMediaFileId: _endFrameMediaFileId,
    ...defaults
  } = brief;
  return {
    ...structuredClone(defaults),
    referenceMediaFileIds: [],
  };
}

function evidenceExpectationsForScene(
  state: StoryboardProjectState,
  sceneId: string,
): string[] {
  const kinds = new Set(
    Object.values(state.evidenceRefs)
      .filter(ref => ref.sceneId === sceneId)
      .map(ref => ref.kind),
  );
  return [...kinds].sort().map(kind => {
    if (kind === 'transcript-moment') return 'Transcript moment';
    if (kind === 'source-range') return 'Source range';
    if (kind === 'generated-candidate') return 'Approved generated candidate';
    return 'Reference image';
  });
}

export function createCustomStoryboardTemplate(
  input: CreateCustomStoryboardTemplateInput,
): StoryboardTemplate {
  if (isBuiltInStoryboardTemplateId(input.id)) {
    throw new Error(`Custom template ${input.id} collides with a built-in template.`);
  }
  const plan = input.state.plans[input.planId];
  if (!plan) throw new Error(`Unknown storyboard plan: ${input.planId}`);
  const scenes = plan.sceneIds
    .map(sceneId => input.state.scenes[sceneId])
    .filter(scene => scene !== undefined);
  if (scenes.length === 0) {
    throw new Error('A custom template requires at least one storyboard scene.');
  }
  const authoredDuration = scenes.reduce(
    (total, scene) => total + scene.targetDurationSeconds,
    0,
  );
  const targetDuration = plan.targetDurationSeconds ?? authoredDuration;
  if (
    !Number.isFinite(authoredDuration) ||
    authoredDuration <= 0 ||
    !Number.isFinite(targetDuration) ||
    targetDuration <= 0
  ) {
    throw new Error('A custom template requires a positive total duration.');
  }
  const usedBeatIds = new Set<string>();
  const uniqueBeatId = (desired: string): string => {
    let candidate = desired;
    let suffix = 2;
    while (usedBeatIds.has(candidate)) {
      candidate = `${desired}-${suffix}`;
      suffix += 1;
    }
    usedBeatIds.add(candidate);
    return candidate;
  };
  const template: StoryboardTemplate = {
    schemaVersion: 1,
    id: input.id,
    name: input.name,
    version: input.version ?? 1,
    description: input.description,
    targetDurationSeconds: targetDuration,
    ...(plan.aspectRatio ? { aspectRatio: plan.aspectRatio } : {}),
    beats: scenes.map((scene, index) => ({
      id: uniqueBeatId(scene.beatId || `beat-${index + 1}`),
      title: scene.title,
      purpose: scene.intent || scene.description,
      targetShare: scene.targetDurationSeconds / authoredDuration,
      ...(scene.sceneKind ? { defaultSceneKind: scene.sceneKind } : {}),
      evidenceExpectations: evidenceExpectationsForScene(input.state, scene.id),
      ...(input.includeGenerationDefaults === false
        ? {}
        : {
            generationDefaults: generationDefaultsFromBrief(
              latestBriefForScene(input.state, scene.id),
            ),
          }),
    })),
  };
  template.beats = template.beats.map(beat => (
    beat.generationDefaults === undefined
      ? Object.fromEntries(
          Object.entries(beat).filter(([key]) => key !== 'generationDefaults'),
        ) as typeof beat
      : beat
  ));
  assertStoryboardTemplate(template, `customTemplate.${template.id}`);
  assertStoryboardTemplateSemantics(template, `customTemplate.${template.id}`);
  return structuredClone(template);
}

export function upsertCustomStoryboardTemplate(
  state: StoryboardProjectState,
  template: StoryboardTemplate,
): StoryboardProjectState {
  assertStoryboardTemplate(template, `customTemplate.${template.id}`);
  assertStoryboardTemplateSemantics(template, `customTemplate.${template.id}`);
  if (isBuiltInStoryboardTemplateId(template.id)) {
    throw new Error(`Custom template ${template.id} collides with a built-in template.`);
  }
  const next = cloneStoryboardProjectState(state);
  next.templates[template.id] = structuredClone(template);
  return next;
}
