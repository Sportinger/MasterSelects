import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import type { AnimatableProperty, EasingType } from '../../../types';
import { animateKeyframe } from '../aiFeedback';
import { normalizeEasingType } from '../../../utils/easing';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleGetKeyframes(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const property = args.property as string | undefined;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  let keyframes = timelineStore.getClipKeyframes(clipId);
  if (property) {
    keyframes = keyframes.filter(kf => kf.property === property);
  }

  return {
    success: true,
    data: {
      clipId,
      clipStartTime: clip.startTime,
      keyframes: keyframes.map(kf => ({
        id: kf.id,
        property: kf.property,
        value: kf.value,
        time: kf.time,
        easing: normalizeEasingType(kf.easing, 'linear'),
      })),
    },
  };
}

export async function handleAddKeyframe(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const property = args.property as AnimatableProperty;
  const value = args.value as number;
  const time = args.time as number | undefined;
  const easing = normalizeEasingType(args.easing as EasingType | undefined, 'ease-in-out');

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const { addKeyframe, invalidateCache } = useTimelineStore.getState();
  addKeyframe(clipId, property, value, time, easing);
  invalidateCache();

  // Visual feedback: keyframe pop animation
  animateKeyframe(clipId, 'add');

  // Find the newly added keyframe
  const keyframes = useTimelineStore.getState().getClipKeyframes(clipId);
  const newKf = keyframes[keyframes.length - 1];

  return {
    success: true,
    data: {
      clipId,
      keyframeId: newKf?.id,
      property,
      value,
      time: newKf?.time ?? time,
      easing: normalizeEasingType(newKf?.easing ?? easing, 'ease-in-out'),
    },
  };
}

export async function handleRemoveKeyframe(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const keyframeId = args.keyframeId as string;

  const { removeKeyframe, invalidateCache } = useTimelineStore.getState();
  removeKeyframe(keyframeId);
  invalidateCache();

  // Visual feedback: keyframe remove animation
  animateKeyframe('', 'remove');

  return {
    success: true,
    data: { removedKeyframeId: keyframeId },
  };
}
