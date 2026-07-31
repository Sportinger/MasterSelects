import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { propertyRegistry } from '../../properties';
import {
  resolveClipPropertyAuthoringContext,
  resolveTransformPositionUnitMode,
  writePropertyAuthoringValue,
} from '../../properties/propertyAuthoring';
import type { ToolResult } from '../types';
import {
  captureMutationEntitySnapshot,
  describeMutationEntities,
} from './mutationEntityResults';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleSetTransform(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Get composition resolution for pixel → normalized conversion
  const updates: Record<string, unknown> = {};
  const hasPosition = args.x !== undefined || args.y !== undefined || args.z !== undefined;
  const hasScale =
    args.scaleAll !== undefined ||
    args.scaleX !== undefined ||
    args.scaleY !== undefined ||
    args.scaleZ !== undefined;
  const hasRotation =
    args.rotation !== undefined ||
    args.rotationX !== undefined ||
    args.rotationY !== undefined ||
    args.rotationZ !== undefined;

  if (!hasPosition && !hasScale && !hasRotation
    && args.opacity === undefined && args.blendMode === undefined) {
    return { success: false, error: 'No transform properties provided' };
  }

  const media = useMediaStore.getState();
  const contextResolution = hasPosition
    ? resolveClipPropertyAuthoringContext({
        clipId,
        compositions: media.compositions,
        activeCompositionId: media.activeCompositionId,
        liveClipIds: timelineStore.clips.map((candidate) => candidate.id),
        positionUnitMode: resolveTransformPositionUnitMode(clip),
      })
    : null;
  if (contextResolution && !contextResolution.ok) {
    const ownerDetails = contextResolution.compositionIds.length > 0
      ? ` (${contextResolution.compositionIds.join(', ')})`
      : '';
    return {
      success: false,
      error: `Cannot resolve property authoring context: ${contextResolution.reason}${ownerDetails}`,
    };
  }
  const authoringContext = contextResolution?.ok
    ? contextResolution.context
    : undefined;
  const propertyInputs: Array<[string, unknown]> = [
    ['position.x', args.x],
    ['position.y', args.y],
    ['position.z', args.z],
    ['scale.all', args.scaleAll],
    ['scale.x', args.scaleX],
    ['scale.y', args.scaleY],
    ['scale.z', args.scaleZ],
    ['rotation.x', args.rotationX],
    ['rotation.y', args.rotationY],
    ['rotation.z', args.rotationZ ?? args.rotation],
    ['opacity', args.opacity],
    ['blendMode', args.blendMode],
  ];

  let workingClip = clip;
  try {
    for (const [path, value] of propertyInputs) {
      if (value === undefined) continue;
      workingClip = writePropertyAuthoringValue(
        propertyRegistry,
        workingClip,
        path,
        value,
        authoringContext,
      );
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  if (hasPosition) updates.position = workingClip.transform.position;
  if (hasScale) updates.scale = workingClip.transform.scale;
  if (hasRotation) updates.rotation = workingClip.transform.rotation;
  if (args.opacity !== undefined) updates.opacity = workingClip.transform.opacity;
  if (args.blendMode !== undefined) updates.blendMode = workingClip.transform.blendMode;

  const mutationSnapshot = captureMutationEntitySnapshot('transform', [clip]);
  const { updateClipTransform, invalidateCache } = useTimelineStore.getState();
  updateClipTransform(clipId, updates);
  invalidateCache();

  return {
    success: true,
    data: {
      clipId,
      updatedProperties: Object.keys(updates),
      ...describeMutationEntities(
        mutationSnapshot,
        useTimelineStore.getState().clips.filter((candidate) => candidate.id === clipId),
      ),
    },
  };
}
