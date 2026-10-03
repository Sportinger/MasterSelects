import type { Keyframe, TimelineClip } from '../../../types';
import { createClipSpeedSource, resolveClipSourceTime } from '../../timeline/retime/clipRetime';
import { isVideoInspectorSectionEnabled } from '../../videoInspector/sectionBypass';

/** Pure policy usable before the store-dependent preview renderer is loaded. */
export function needsProcessedAudioPreview(clip: TimelineClip, keys: readonly Keyframe[]): boolean {
  if (clip.timeRemap?.kind === 'freeze') return false;
  if (clip.timeRemap?.kind === 'loop' || clip.timeRemap?.kind === 'warp') return true;
  const source = createClipSpeedSource(clip, keys);
  // Render all automated portions, including forward segments, with offline pitch policy.
  if (isVideoInspectorSectionEnabled(clip.videoInspectorSections, 'speedChange') &&
    keys.some(key => key.property === 'speed')) return true;
  const initial = resolveClipSourceTime(clip, 0, source);
  return initial.sourceRate < 0.25 || initial.sourceRate > 4 ||
    Boolean(clip.transitionSourceMap || clip.transitionSourceHold ||
      Number.isFinite(clip.transitionSourceTimeOverride));
}
