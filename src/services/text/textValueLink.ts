import type { AnimatableProperty } from '../../types';
import type { TimelineClip } from '../../types/timeline';
import type { useTimelineStore } from '../../stores/timeline';
import { propertyRegistry } from '../properties';
import { interpolateKeyframes } from '../../utils/keyframeInterpolation';

type TimelineStoreGlobal = typeof globalThis & { __timelineStoreModule?: { useTimelineStore: typeof useTimelineStore } };

/**
 * Resolves a text clip's {value}: its own sampled Value, or the linked clip's
 * numeric property at the same timeline time. Unresolvable links (missing clip,
 * other composition, non-numeric path) fall back to the own value.
 * The store is read through its global handle: render modules load inside the store's import graph.
 */
export function resolveTextClipValue(clip: TimelineClip, ownValue: number, localTime: number): number {
  const link = clip.textProperties?.valueLink;
  if (!link || link.clipId === clip.id) return ownValue;
  const state = (globalThis as TimelineStoreGlobal).__timelineStoreModule?.useTimelineStore.getState();
  if (!state) return ownValue;
  const target = state.clips.find(candidate => candidate.id === link.clipId);
  if (!target) return ownValue;
  const targetTime = Math.max(0, Math.min(target.duration, clip.startTime + localTime - target.startTime));
  if (link.property === 'speed') return state.getInterpolatedSpeed(target.id, targetTime);
  const base = propertyRegistry.readValue(target, link.property);
  if (typeof base !== 'number' && !(state.clipKeyframes.get(target.id) ?? []).some(key => key.property === link.property)) return ownValue;
  const value = interpolateKeyframes(state.clipKeyframes.get(target.id) ?? [], link.property as AnimatableProperty, targetTime,
    typeof base === 'number' ? base : ownValue);
  return Number.isFinite(value) ? value : ownValue;
}
