import type { StoryboardScene, StoryboardTemplate } from '../contracts';
import type {
  StoryboardTemplateMappingConfidence,
  StoryboardTemplateMappingResult,
  StoryboardTemplateSceneMapping,
} from './types';

function normalize(value: string | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function mapping(
  scene: StoryboardScene,
  beatId: string,
  confidence: StoryboardTemplateMappingConfidence,
  reason: string,
): StoryboardTemplateSceneMapping {
  return { sceneId: scene.id, beatId, confidence, reason };
}

export function mapStoryboardScenesToTemplate(input: {
  readonly scenes: readonly StoryboardScene[];
  readonly template: StoryboardTemplate;
  readonly explicitMappings?: Readonly<Record<string, string>>;
}): StoryboardTemplateMappingResult {
  const beatById = new Map(input.template.beats.map(beat => [beat.id, beat]));
  const availableBeatIds = new Set(beatById.keys());
  const unmappedScenes = [...input.scenes];
  const mappings: StoryboardTemplateSceneMapping[] = [];

  for (const scene of [...unmappedScenes]) {
    const explicitBeatId = input.explicitMappings?.[scene.id];
    if (!explicitBeatId) continue;
    if (!availableBeatIds.has(explicitBeatId)) {
      throw new Error(`Explicit template mapping references unavailable beat ${explicitBeatId}.`);
    }
    mappings.push(mapping(scene, explicitBeatId, 'manual', 'Explicit user mapping.'));
    availableBeatIds.delete(explicitBeatId);
    unmappedScenes.splice(unmappedScenes.indexOf(scene), 1);
  }

  const takeMatches = (
    confidence: StoryboardTemplateMappingConfidence,
    reason: string,
    predicate: (scene: StoryboardScene, beatId: string) => boolean,
  ) => {
    for (const scene of [...unmappedScenes]) {
      const candidates = [...availableBeatIds].filter(beatId => predicate(scene, beatId));
      if (candidates.length !== 1) continue;
      const beatId = candidates[0];
      mappings.push(mapping(scene, beatId, confidence, reason));
      availableBeatIds.delete(beatId);
      unmappedScenes.splice(unmappedScenes.indexOf(scene), 1);
    }
  };

  takeMatches(
    'beat-id',
    'Existing scene beat identity matches the template.',
    (scene, beatId) => scene.beatId === beatId,
  );
  takeMatches(
    'title',
    'Normalized scene and beat titles match.',
    (scene, beatId) => normalize(scene.title) === normalize(beatById.get(beatId)?.title),
  );
  takeMatches(
    'scene-kind',
    'Scene kind matches one remaining template beat.',
    (scene, beatId) => (
      !!scene.sceneKind &&
      normalize(scene.sceneKind) === normalize(beatById.get(beatId)?.defaultSceneKind)
    ),
  );

  for (const scene of [...unmappedScenes]) {
    const beatId = [...availableBeatIds][0];
    if (!beatId) break;
    mappings.push(mapping(
      scene,
      beatId,
      'position',
      'Mapped by remaining scene and beat order; review before restructuring.',
    ));
    availableBeatIds.delete(beatId);
    unmappedScenes.splice(unmappedScenes.indexOf(scene), 1);
  }

  const sceneOrder = new Map(input.scenes.map((scene, index) => [scene.id, index]));
  return {
    mappings: mappings.toSorted((left, right) =>
      (sceneOrder.get(left.sceneId) ?? Number.MAX_SAFE_INTEGER) -
        (sceneOrder.get(right.sceneId) ?? Number.MAX_SAFE_INTEGER) ||
      left.beatId.localeCompare(right.beatId)
    ),
    unmappedSceneIds: unmappedScenes.map(scene => scene.id),
    unmappedBeatIds: [...availableBeatIds],
  };
}
