import './TimelineToolOverlayLayer.css';
import type { CSSProperties } from 'react';
import type { TimelineClip, TimelineTrack } from '../../../types';
import type { TimelineToolPreview } from '../../../stores/timeline/types';
import { resolveTimelineToolOverlayLayout } from './timelineToolOverlayLayout';

export interface TimelineToolOverlayLayerProps {
  preview: TimelineToolPreview | null;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  duration: number;
  timeToPixel: (time: number) => number;
  getTrackHeight: (track: TimelineTrack) => number;
}

export function TimelineToolOverlayLayer({
  preview,
  tracks,
  clips,
  duration,
  timeToPixel,
  getTrackHeight,
}: TimelineToolOverlayLayerProps) {
  const layout = resolveTimelineToolOverlayLayout({
    preview,
    tracks,
    clips,
    duration,
    timeToPixel,
    getTrackHeight,
  });

  if (layout.items.length === 0) return null;

  return (
    <div
      className="timeline-tool-overlay-layer"
      style={{ height: layout.contentHeight }}
      aria-hidden="true"
    >
      {layout.items.map((item) => {
        const style: CSSProperties = {
          left: item.left,
          top: item.top,
          height: item.height,
        };
        if (item.width !== undefined) {
          style.width = item.width;
        }

        return (
          <div
            key={item.id}
            className={[
              'timeline-tool-overlay-item',
              `timeline-tool-overlay-${item.kind}`,
              item.direction ?? '',
              item.variant ? `variant-${item.variant}` : '',
              `tool-${item.toolId}`,
            ].filter(Boolean).join(' ')}
            data-tool-overlay-kind={item.kind}
            data-tool-overlay-variant={item.variant}
            data-tool-id={item.toolId}
            data-track-id={item.trackId}
            style={style}
          >
            {item.kind === 'blocked-message' ? item.message : null}
            {item.kind === 'placement-ghost' && (
              <span className="timeline-tool-overlay-placement-label">
                <span className="timeline-tool-overlay-placement-name">{item.label ?? 'Source'}</span>
                {item.sourceInPoint !== undefined && item.sourceOutPoint !== undefined && (
                  <span className="timeline-tool-overlay-placement-range">
                    {formatOverlaySeconds(item.sourceInPoint)}-{formatOverlaySeconds(item.sourceOutPoint)}
                  </span>
                )}
              </span>
            )}
            {item.kind === 'operation-ghost' && item.label && (
              <span className="timeline-tool-overlay-operation-label">
                {item.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatOverlaySeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return '0.00s';
  return `${seconds.toFixed(Math.abs(seconds) < 10 ? 2 : 1)}s`;
}
