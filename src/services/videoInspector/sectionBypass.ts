import type { ClipTransform } from '../../types/timelineCore';
import type {
  ClipVideoInspectorSections,
  TimelineClip,
  VideoInspectorSectionKey,
} from '../../types/timeline';

const DEFAULT_DISABLED_SECTIONS = new Set<VideoInspectorSectionKey>(['dynamicZoom']);

export function isVideoInspectorSectionEnabled(
  sections: ClipVideoInspectorSections | undefined,
  section: VideoInspectorSectionKey,
): boolean {
  const configured = sections?.[section];
  if (configured !== undefined) return configured;
  return !DEFAULT_DISABLED_SECTIONS.has(section);
}

/**
 * Applies inspector bypasses after interpolation while preserving the stored
 * values and keyframes, so re-enabling a section restores the exact edit.
 */
export function applyVideoInspectorTransformBypass(
  clip: TimelineClip,
  transform: ClipTransform,
): ClipTransform {
  const transformEnabled = isVideoInspectorSectionEnabled(
    clip.videoInspectorSections,
    'transform',
  );
  const compositeEnabled = isVideoInspectorSectionEnabled(
    clip.videoInspectorSections,
    'composite',
  );

  if (transformEnabled && compositeEnabled) return transform;

  return {
    ...transform,
    ...(compositeEnabled ? {} : { opacity: 1, blendMode: 'normal' as const }),
    ...(transformEnabled
      ? {}
      : {
          position: { x: 0, y: 0, z: 0 },
          anchor: { x: 0, y: 0, z: 0 },
          scale: {
            ...(transform.scale.all !== undefined ? { all: 1 } : {}),
            x: 1,
            y: 1,
            ...(transform.scale.z !== undefined ? { z: 1 } : {}),
          },
          rotation: { x: 0, y: 0, z: 0 },
        }),
  };
}

export function applyVideoInspectorSpeedBypass(
  clip: TimelineClip,
  speed: number,
): number {
  return isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange')
    ? speed
    : 1;
}
