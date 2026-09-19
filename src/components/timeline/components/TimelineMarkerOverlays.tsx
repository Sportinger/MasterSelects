import type { CSSProperties } from 'react';
import type { TimelineMarker } from '../../../stores/timeline/types';

type MarkerAnimationState = 'add' | 'remove';

interface TimelineMarkerDragState {
  markerId: string;
}

interface MarkerCreateDragState {
  currentTime: number;
  dropAnimating: boolean;
  isOverTimeline: boolean;
}

interface TimelineMarkerOverlaysProps {
  aiAnimatedMarkers: Map<string, MarkerAnimationState>;
  formatTime: (seconds: number) => string;
  getTimelineLineOpacity: (left: number) => number;
  markerCreateDrag: MarkerCreateDragState | null;
  markers: TimelineMarker[];
  onMarkerContextMenu: (event: React.MouseEvent, markerId: string) => void;
  onMarkerPointerDown: (event: React.PointerEvent<HTMLElement>, markerId: string) => void;
  scrollX: number;
  switchMotionClass: string;
  timeToPixel: (time: number) => number;
  timelineMarkerDrag: TimelineMarkerDragState | null;
  trackHeaderWidth: number;
}

function getMarkerAnimationClass(
  aiAnimatedMarkers: Map<string, MarkerAnimationState>,
  markerId: string,
): string {
  const animationState = aiAnimatedMarkers.get(markerId);
  if (animationState === 'add') return 'ai-marker-added';
  if (animationState === 'remove') return 'ai-marker-removed';
  return '';
}

export function TimelineMarkerOverlays({
  aiAnimatedMarkers,
  formatTime,
  getTimelineLineOpacity,
  markerCreateDrag,
  markers,
  onMarkerContextMenu,
  onMarkerPointerDown,
  scrollX,
  switchMotionClass,
  timeToPixel,
  timelineMarkerDrag,
  trackHeaderWidth,
}: TimelineMarkerOverlaysProps) {
  return (
    <>
      {markers.map((marker) => {
        const markerLeft = timeToPixel(marker.time) - scrollX + trackHeaderWidth;
        const markerLineOpacity = timelineMarkerDrag?.markerId === marker.id
          ? 1
          : getTimelineLineOpacity(markerLeft);

        return (
          <div
            key={marker.id}
            className={`timeline-marker ${switchMotionClass} ${marker.stopPlayback ? 'is-stop-marker' : ''} ${timelineMarkerDrag?.markerId === marker.id ? 'dragging' : ''} ${getMarkerAnimationClass(aiAnimatedMarkers, marker.id)}`}
            style={{
              left: markerLeft,
              '--marker-color': marker.color,
              '--timeline-line-opacity': markerLineOpacity,
            } as CSSProperties}
            title={`${marker.stopPlayback ? 'Stop Marker' : (marker.label || 'Marker')}: ${formatTime(marker.time)} (drag to move, right-click for MIDI and transport actions)${marker.stopPlayback ? ' - playback stops automatically here' : ''}`}
            onContextMenu={(event) => onMarkerContextMenu(event, marker.id)}
          >
            <div
              className="timeline-marker-head"
              onPointerDown={(event) => onMarkerPointerDown(event, marker.id)}
            >
              {marker.stopPlayback ? 'S' : 'M'}
            </div>
            <div className="timeline-marker-line" />
          </div>
        );
      })}

      {markerCreateDrag && markerCreateDrag.isOverTimeline && (
        <div
          className={`timeline-marker ghost ${markerCreateDrag.dropAnimating ? 'drop-animation' : ''}`}
          style={{
            left: timeToPixel(markerCreateDrag.currentTime) - scrollX + trackHeaderWidth,
            '--marker-color': '#2997E5',
            '--timeline-line-opacity': 1,
          } as CSSProperties}
        >
          <div className="timeline-marker-head">M</div>
          <div className="timeline-marker-line" />
        </div>
      )}
    </>
  );
}
