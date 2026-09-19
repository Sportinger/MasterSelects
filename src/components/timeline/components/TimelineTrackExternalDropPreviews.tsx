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
  if (externalDrag.replaceClipId) {
    if (externalDrag.trackId !== trackId) return null;
    return (
      <div
        className={`timeline-clip-preview video timeline-clip-replace-preview${externalDrag.thumbnailUrl ? ' has-thumbnail' : ''}`}
        data-replace-clip-id={externalDrag.replaceClipId}
        style={{ left: previewRect.x, width: previewRect.width }}
      >
        {externalDrag.thumbnailUrl && (
          <div
            className="timeline-clip-preview-thumbnail"
            style={{ backgroundImage: `url("${externalDrag.thumbnailUrl.replace(/"/g, '\\"')}")` }}
          />
        )}
        <div className="clip-content">
          <span className="timeline-clip-replace-kicker">Replace source</span>
          <span className="clip-name">{externalDrag.label ?? 'New video'}</span>
          <span className="timeline-clip-replace-note">Effects + keyframes stay</span>
        </div>
      </div>
    );
  }

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
