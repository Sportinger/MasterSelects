// Lane layout of the phone timeline: video tracks on top (store order), the lowest video track is
// the emphasized main track, then audio, then the rest. Lane heights follow the editor's track
// focus (Timeline → View), so the focused kind of track gets the room.

import type { TimelineTrackFocusMode } from '../../../stores/timeline/types';
import type { TimelineTrack } from '../../../types/timeline';
import type { PhoneLane, PhoneLaneKind } from './PhoneClipStrip';

const LANE_GAP = 4;
type LaneHeights = Record<PhoneLaneKind | 'main', number>;
/** Lane heights per editor track focus (Timeline → View): the focused kind gets the room. */
const LANE_HEIGHTS: Record<TimelineTrackFocusMode, LaneHeights> = {
  balanced: { main: 56, video: 40, audio: 36, other: 32 },
  video: { main: 72, video: 56, audio: 24, other: 24 },
  audio: { main: 40, video: 28, audio: 56, other: 32 },
};

function laneKind(track: TimelineTrack): PhoneLaneKind {
  if (track.type === 'video') return 'video';
  if (track.type === 'audio') return 'audio';
  return 'other';
}

/** Video tracks on top (store order), the lowest video track is the emphasized main track. */
export function buildPhoneLanes(tracks: readonly TimelineTrack[], focus: TimelineTrackFocusMode = 'balanced'): { lanes: PhoneLane[]; height: number } {
  const LANE_HEIGHT = LANE_HEIGHTS[focus] ?? LANE_HEIGHTS.balanced;
  const video = tracks.filter((track) => track.type === 'video');
  const audio = tracks.filter((track) => track.type === 'audio');
  const other = tracks.filter((track) => track.type !== 'video' && track.type !== 'audio');
  const mainId = video[video.length - 1]?.id;
  let top = LANE_GAP;
  const lanes = [...video, ...audio, ...other].map((track): PhoneLane => {
    const kind = laneKind(track);
    const main = track.id === mainId;
    const height = main ? LANE_HEIGHT.main : LANE_HEIGHT[kind];
    const lane = { trackId: track.id, name: track.name, kind, main, top, height };
    top += height + LANE_GAP;
    return lane;
  });
  return { lanes, height: top };
}
