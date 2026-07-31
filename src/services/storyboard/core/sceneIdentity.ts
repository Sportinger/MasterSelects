import type { StoryboardClipProperties } from '../../../types/storyboard';

let fallbackSceneIdCounter = 0;

export type StoryboardSceneIdFactory = () => string;

export function createStoryboardSceneId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `scene-${crypto.randomUUID()}`;
  }
  fallbackSceneIdCounter += 1;
  return `scene-${Date.now().toString(36)}-${fallbackSceneIdCounter.toString(36)}`;
}

export function cloneStoryboardClipProperties(
  properties: StoryboardClipProperties | undefined,
): StoryboardClipProperties | undefined {
  if (!properties) return undefined;
  return {
    ...properties,
    filledClipIds: properties.filledClipIds ? [...properties.filledClipIds] : undefined,
    evidenceRefIds: properties.evidenceRefIds ? [...properties.evidenceRefIds] : undefined,
    variantSetIds: properties.variantSetIds ? [...properties.variantSetIds] : undefined,
  };
}

/**
 * Copy/repair keeps semantic identity. A split keeps it only on the first part;
 * every later part becomes a new scene.
 */
export function cloneStoryboardPropertiesForSplit(
  properties: StoryboardClipProperties | undefined,
  splitPartIndex: number,
  createSceneId: StoryboardSceneIdFactory = createStoryboardSceneId,
): StoryboardClipProperties | undefined {
  const clone = cloneStoryboardClipProperties(properties);
  if (!clone || splitPartIndex <= 0) return clone;
  return {
    ...clone,
    sceneId: createSceneId(),
  };
}
