import { useTimelineStore } from '../../../stores/timeline';
import { useSettingsStore } from '../../../stores/settingsStore';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { ClipDragState, ClipTrimState } from '../types';
import { getLinkedSelectionGroups } from '../utils/linkedSelectionGroups';
import { resolveClipGeometry } from '../utils/timelineClipCanvasClipGeometry';
import { getLinkedSelectionContour, type SelectionRect } from '../utils/linkedSelectionContour';

interface Props {
  clips: TimelineClip[];
  tracks: TimelineTrack[];
  clipDrag: ClipDragState | null;
  clipTrim: ClipTrimState | null;
  timeToPixel: (time: number) => number;
  getTrackHeight: (track: TimelineTrack) => number;
  getTrackBaseHeight: (track: TimelineTrack) => number;
}

export function LinkedSelectionOutline({ clips, tracks, clipDrag, clipTrim, timeToPixel, getTrackHeight, getTrackBaseHeight }: Props) {
  const selectedIds = useTimelineStore(state => state.selectedClipIds);
  const clipDragPreview = useTimelineStore(state => state.clipDragPreview);
  const color = useSettingsStore(state => state.theme === 'resolve' ? '#ef4b3f' : '#ffffff');
  let top = 0;
  const layouts = new Map(tracks.map(track => {
    const layout = { top, height: getTrackBaseHeight(track) };
    top += getTrackHeight(track);
    return [track.id, layout] as const;
  }));
  return <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 100, overflow: 'visible' }}>
    {getLinkedSelectionGroups(clips, selectedIds).map(group => {
      const rects: SelectionRect[] = [];
      for (const clip of group) {
        for (const [trackId, layout] of layouts) {
          const geometry = resolveClipGeometry(clip, { trackId, clipDrag, clipDragPreview, clipTrim });
          if (!geometry.visible || geometry.duration <= 0) continue;
          rects.push({ left: timeToPixel(geometry.startTime), right: timeToPixel(geometry.startTime + geometry.duration),
            top: layout.top, bottom: layout.top + layout.height });
        }
      }
      return <path key={group[0].id} data-linked-selection-outline="true"
        d={getLinkedSelectionContour(rects)} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />;
    })}
  </svg>;
}
