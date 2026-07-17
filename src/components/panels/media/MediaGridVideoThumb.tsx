import React, { useCallback, useRef, useState } from 'react';
import type { MediaFile } from '../../../stores/mediaStore';
import { FileTypeIcon } from './FileTypeIcon';
import { LiveInputPreviewCanvas } from './LiveInputPreviewCanvas';

interface MediaGridVideoThumbProps {
  mediaFile: MediaFile;
  thumbUrl?: string;
  onError?: () => void;
}

/**
 * Video thumbnail for the media-panel grid/slot view that scrubs a preview on
 * hover, like the board view (#201). Moving the pointer across the thumb seeks
 * the video; leaving restores the poster frame.
 */
export function MediaGridVideoThumb({ mediaFile, thumbUrl, onError }: MediaGridVideoThumbProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const videoUrl = mediaFile.proxyVideoUrl || mediaFile.url;

  const scrubTo = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.width > 0
      ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width))
      : 0;
    try {
      video.currentTime = Math.min(duration - 0.05, duration * ratio);
    } catch {
      /* seeking can throw before metadata is ready */
    }
  }, []);

  const handleEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    setHovering(true);
    scrubTo(event);
  }, [scrubTo]);

  const handleMove = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    if (hovering) scrubTo(event);
  }, [hovering, scrubTo]);

  const handleLeave = useCallback(() => {
    setHovering(false);
    videoRef.current?.pause();
  }, []);

  if (mediaFile.liveInput) {
    return (
      <div className="media-grid-video-thumb">
        <div className="media-grid-thumb-placeholder">
          <FileTypeIcon type="video" large />
        </div>
        <LiveInputPreviewCanvas
          className="media-grid-live-preview"
          liveInputId={mediaFile.id}
        />
      </div>
    );
  }

  return (
    <div
      className="media-grid-video-thumb"
      onMouseEnter={handleEnter}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      {thumbUrl ? (
        <img src={thumbUrl} alt="" draggable={false} onError={onError} />
      ) : (
        <div className="media-grid-thumb-placeholder">
          <FileTypeIcon type="video" large />
        </div>
      )}
      {hovering && (
        <video
          ref={videoRef}
          className="media-grid-video-preview"
          src={videoUrl}
          poster={thumbUrl}
          muted
          playsInline
          loop
          preload="auto"
          draggable={false}
          onError={onError}
        />
      )}
    </div>
  );
}
