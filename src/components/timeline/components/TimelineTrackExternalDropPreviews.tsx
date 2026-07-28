import type { ReactNode } from 'react';
import type { ExternalDragState } from '../types';
import type { ClipInteractionShellRect } from '../interactionShell';

type TimelineTrackExternalDropPreviewsProps = {
  externalDrag: ExternalDragState | null;
  getTrackRangeShellRect: (startTime: number, duration: number) => ClipInteractionShellRect;
  trackId: string;
};

const renderExternalPreview = (
  className: string,
  rect: Pick<ClipInteractionShellRect, 'x' | 'width'>,
  label: string,
  thumbnailUrl?: string,
): ReactNode => (
  <div
    className={`${className}${thumbnailUrl ? ' has-thumbnail' : ''}`}
    style={{
      left: rect.x,
      width: rect.width,
    }}
  >
    {thumbnailUrl && (
      <div
        className="timeline-clip-preview-thumbnail"
        style={{ backgroundImage: `url("${thumbnailUrl.replace(/"/g, '\\"')}")` }}
      />
    )}
    <div className="clip-content">
      <span className="clip-name">{label}</span>
    </div>
  </div>
);

export function TimelineTrackExternalDropPreviews({
  externalDrag,
  getTrackRangeShellRect,
  trackId,
}: TimelineTrackExternalDropPreviewsProps) {
  if (!externalDrag) return null;

  const duration = externalDrag.duration ?? 5;
  const previewRect = getTrackRangeShellRect(externalDrag.startTime, duration);
  const primaryTrackType = externalDrag.isAudio || externalDrag.videoTrackId
    ? 'audio'
    : 'video';
  return (
    <>
      {externalDrag.trackId === trackId && renderExternalPreview(
        `timeline-clip-preview ${primaryTrackType}`,
        previewRect,
        externalDrag.label ?? 'Drop to add clip',
        externalDrag.thumbnailUrl,
      )}
      {externalDrag.videoTrackId === trackId && renderExternalPreview(
        'timeline-clip-preview video',
        previewRect,
        externalDrag.label ?? 'Video',
        externalDrag.thumbnailUrl,
      )}
    </>
  );
}
