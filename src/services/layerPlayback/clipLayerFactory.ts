import type { Layer } from '../../types/layers';
import type { BlendMode } from '../../types/blendMode';
import type { TimelineClip } from '../../types/timeline';
import type { ClipTransform } from '../../types/timelineCore';
import { getEffectiveScale } from '../../utils/transformScale';
import {
  ensureRuntimeFrameProvider,
  getRuntimeFrameProvider,
  isProviderBackedRuntimeSource,
  updateRuntimePlaybackTime,
} from '../mediaRuntime/runtimePlayback';

export function buildBackgroundClipLayer(
  clip: TimelineClip,
  clipTime: number,
  transform: ClipTransform
): Layer | null {
  const baseLayer = {
    id: `bg-clip-${clip.id}`,
    name: clip.name,
    visible: true,
    opacity: transform.opacity ?? 1,
    blendMode: (transform.blendMode || 'normal') as BlendMode,
    effects: clip.effects || [],
    position: {
      x: transform.position?.x || 0,
      y: transform.position?.y || 0,
      z: transform.position?.z || 0,
    },
    scale: getEffectiveScale(transform.scale),
    rotation: {
      x: ((transform.rotation?.x || 0) * Math.PI) / 180,
      y: ((transform.rotation?.y || 0) * Math.PI) / 180,
      z: ((transform.rotation?.z || 0) * Math.PI) / 180,
    },
  };

  const source = clip.source;
  if (source?.videoElement || isProviderBackedRuntimeSource(source)) {
    updateRuntimePlaybackTime(source, clipTime, 'background');
    const runtimeProvider =
      getRuntimeFrameProvider(source, 'background') ??
      source?.webCodecsPlayer;
    if (!runtimeProvider && isProviderBackedRuntimeSource(source)) {
      void ensureRuntimeFrameProvider(source, 'background', clipTime);
    }
    return {
      ...baseLayer,
      source: {
        type: 'video',
        videoElement: source?.videoElement,
        webCodecsPlayer: runtimeProvider ?? undefined,
        runtimeSourceId: source?.runtimeSourceId,
        runtimeSessionKey: source?.runtimeSessionKey,
      },
    } as Layer;
  }

  if (clip.source?.imageElement) {
    return {
      ...baseLayer,
      source: { type: 'image', imageElement: clip.source.imageElement },
    } as Layer;
  }

  if (clip.source?.textCanvas) {
    return {
      ...baseLayer,
      source: { type: 'text', textCanvas: clip.source.textCanvas },
    } as Layer;
  }

  return null;
}
