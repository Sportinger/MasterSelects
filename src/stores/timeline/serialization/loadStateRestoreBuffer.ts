import type { Keyframe } from '../../../types/keyframes';
import type { TimelineClip } from '../../../types/timeline';
import type { TimelineStore } from '../types';

type TimelineSet = (
  partial: Partial<TimelineStore> | ((state: TimelineStore) => Partial<TimelineStore>),
) => void;

export function createLoadStateRestoreBuffer(set: TimelineSet) {
  const clips: TimelineClip[] = [];
  const nestedKeyframes = new Map<string, Keyframe[]>();

  const flush = () => {
    if (clips.length === 0 && nestedKeyframes.size === 0) return;
    const nextClips = clips.splice(0);
    const nextKeyframes = new Map(nestedKeyframes);
    nestedKeyframes.clear();
    set(state => ({
      clips: [...state.clips, ...nextClips],
      ...(nextKeyframes.size > 0 ? {
        clipKeyframes: new Map([
          ...(state.clipKeyframes ?? new Map<string, Keyframe[]>()),
          ...nextKeyframes,
        ]),
      } : {}),
    }));
  };

  const push = (clip: TimelineClip) => {
    clips.push(clip);
    if (clips.length >= 128) flush();
  };

  const patch = (clipId: string, updater: (clip: TimelineClip) => TimelineClip): boolean => {
    const index = clips.findIndex((candidate) => candidate.id === clipId);
    if (index < 0) {
      set(state => ({ clips: state.clips.map(clip => clip.id === clipId ? updater(clip) : clip) }));
      return false;
    }
    clips[index] = updater(clips[index]);
    return true;
  };

  const pushNestedKeyframes = (keyframes: ReadonlyMap<string, Keyframe[]>) => {
    keyframes.forEach((value, clipId) => nestedKeyframes.set(clipId, value));
  };

  return { flush, patch, push, pushNestedKeyframes };
}
