import type { TimelineStore } from '../types';

export function cleanupNodeParamTimelineState(
  state: TimelineStore,
  clipId: string,
  nodeId: string,
  allowedParamIds: Set<string> | null,
): Partial<TimelineStore> {
  return cleanupPrefixedTimelineState(state, clipId, `node.${nodeId}.`, allowedParamIds);
}

export function cleanupEffectParamTimelineState(
  state: TimelineStore,
  clipId: string,
  effectId: string,
): Partial<TimelineStore> {
  return cleanupPrefixedTimelineState(state, clipId, `effect.${effectId}.`, null);
}

function cleanupPrefixedTimelineState(
  state: TimelineStore,
  clipId: string,
  propertyPrefix: string,
  allowedParamIds: Set<string> | null,
): Partial<TimelineStore> {
  const shouldRemoveProperty = (property: string) => {
    if (!property.startsWith(propertyPrefix)) {
      return false;
    }
    if (!allowedParamIds) {
      return true;
    }
    const propertyName = property.slice(propertyPrefix.length);
    const baseParamId = propertyName.split('.')[0];
    return !allowedParamIds.has(propertyName) && !allowedParamIds.has(baseParamId);
  };

  const existingKeyframes = state.clipKeyframes.get(clipId) ?? [];
  const removedKeyframeIds = new Set<string>();
  const retainedKeyframes = existingKeyframes.filter((keyframe) => {
    const remove = shouldRemoveProperty(keyframe.property);
    if (remove) {
      removedKeyframeIds.add(keyframe.id);
    }
    return !remove;
  });
  const clipKeyframes = retainedKeyframes.length === existingKeyframes.length
    ? state.clipKeyframes
    : new Map(state.clipKeyframes);
  if (clipKeyframes !== state.clipKeyframes) {
    if (retainedKeyframes.length > 0) {
      clipKeyframes.set(clipId, retainedKeyframes);
    } else {
      clipKeyframes.delete(clipId);
    }
  }

  let recordingChanged = false;
  const keyframeRecordingEnabled = new Set(
    [...state.keyframeRecordingEnabled].filter((key) => {
      const separatorIndex = key.indexOf(':');
      const recordingClipId = separatorIndex === -1 ? key : key.slice(0, separatorIndex);
      const property = separatorIndex === -1 ? '' : key.slice(separatorIndex + 1);
      const keep = recordingClipId !== clipId || !shouldRemoveProperty(property);
      if (!keep) {
        recordingChanged = true;
      }
      return keep;
    }),
  );

  const selectedKeyframeIds = removedKeyframeIds.size === 0
    ? state.selectedKeyframeIds
    : new Set([...state.selectedKeyframeIds].filter((id) => !removedKeyframeIds.has(id)));

  let expandedChanged = false;
  const expandedCurveProperties = new Map(state.expandedCurveProperties);
  for (const [trackId, properties] of expandedCurveProperties) {
    const retainedProperties = new Set([...properties].filter((property) => !shouldRemoveProperty(property)));
    if (retainedProperties.size > 0) {
      if (retainedProperties.size !== properties.size) {
        expandedChanged = true;
        expandedCurveProperties.set(trackId, retainedProperties);
      }
    } else {
      expandedChanged = true;
      expandedCurveProperties.delete(trackId);
    }
  }

  return {
    ...(clipKeyframes !== state.clipKeyframes ? { clipKeyframes } : {}),
    ...(recordingChanged ? { keyframeRecordingEnabled } : {}),
    ...(selectedKeyframeIds !== state.selectedKeyframeIds ? { selectedKeyframeIds } : {}),
    ...(expandedChanged ? { expandedCurveProperties } : {}),
  };
}
