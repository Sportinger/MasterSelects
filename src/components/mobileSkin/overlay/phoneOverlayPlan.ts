// Pure parts of the overlay sheet: which clips count as overlays at the playhead, and the
// picture-in-picture transform (uniform scale on top of the clip's fit, offset to a corner).

import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { findPhoneMainVideoTrackId } from '../media/phoneMediaPlacement';

export type PhoneOverlaySize = 'small' | 'medium' | 'large';
export type PhoneOverlayPlace = 'center' | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export const PHONE_OVERLAY_SIZES: readonly { value: PhoneOverlaySize; label: string; scale: number }[] = [
  { value: 'small', label: 'Small', scale: 1 / 3 },
  { value: 'medium', label: 'Medium', scale: 0.5 },
  { value: 'large', label: 'Large', scale: 0.75 },
];

export const PHONE_OVERLAY_PLACES: readonly { value: PhoneOverlayPlace; label: string }[] = [
  { value: 'center', label: 'Centre' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
];

/** Gap to the frame edge in half-frame units (the clip position unit), about 3 % of the frame. */
const EDGE_GAP = 0.06;
const EPSILON = 1e-6;

export interface PhoneOverlayEntry {
  clipId: string;
  name: string;
  trackId: string;
  trackName: string;
}

/** Clips on video tracks above the main picture that cover the playhead, top track first. */
export function listPhoneOverlaysAtPlayhead(
  tracks: readonly Pick<TimelineTrack, 'id' | 'type' | 'locked' | 'name'>[],
  clips: readonly Pick<TimelineClip, 'id' | 'name' | 'trackId' | 'startTime' | 'duration'>[],
  playhead: number,
): PhoneOverlayEntry[] {
  const mainId = findPhoneMainVideoTrackId(tracks);
  const entries: PhoneOverlayEntry[] = [];
  for (const track of tracks) {
    if (track.type !== 'video' || track.id === mainId) continue;
    for (const clip of clips) {
      if (clip.trackId !== track.id) continue;
      if (playhead < clip.startTime - EPSILON || playhead >= clip.startTime + clip.duration - EPSILON) continue;
      entries.push({ clipId: clip.id, name: clip.name, trackId: track.id, trackName: track.name });
    }
  }
  return entries;
}

export interface PhoneOverlayTransform {
  /** Uniform scale on top of the fit the clip was placed with ('scale.all'). */
  scale: number;
  /** Clip position in half-frame units ('position.x' / 'position.y'; +y is down). */
  x: number;
  y: number;
}

/**
 * Picture-in-picture transform for a clip placed with fit. `source` and `comp` are pixel sizes; the
 * clip covers the fitted share of the frame times `scale`.
 */
export function phoneOverlayTransform(
  size: PhoneOverlaySize,
  place: PhoneOverlayPlace,
  source: { width: number; height: number } | null,
  comp: { width: number; height: number },
): PhoneOverlayTransform {
  const scale = PHONE_OVERLAY_SIZES.find((entry) => entry.value === size)?.scale ?? 0.5;
  if (place === 'center') return { scale, x: 0, y: 0 };
  const sourceAspect = source ? source.width / source.height : comp.width / comp.height;
  const compAspect = comp.width / comp.height;
  const halfWidth = Math.min(1, sourceAspect / compAspect) * scale;
  const halfHeight = Math.min(1, compAspect / sourceAspect) * scale;
  const x = Math.max(0, 1 - EDGE_GAP - halfWidth);
  const y = Math.max(0, 1 - EDGE_GAP * compAspect - halfHeight);
  return {
    scale,
    x: place.endsWith('left') ? -x : x,
    y: place.startsWith('top') ? -y : y,
  };
}
