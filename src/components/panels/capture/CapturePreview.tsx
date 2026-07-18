import { useEffect, useRef, useState } from 'react';
import type { CaptureSessionSnapshot } from '../../../services/capture/recording/sessionTypes';
import {
  mapOverlayCropToSource,
  mapSourceCropToOverlay,
  type CaptureCropRect,
} from '../../../services/capture/recording/frameTransform';

export interface CapturePreviewProps {
  stream: MediaStream | null;
  snapshot: CaptureSessionSnapshot;
  crop?: CaptureCropRect;
  cropEnabled?: boolean;
  onCropChange?(crop: CaptureCropRect | undefined): void;
}

export function CapturePreview({ stream, snapshot, crop, cropEnabled, onCropChange }: CapturePreviewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<CaptureCropRect>();
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
    return () => {
      if (video.srcObject === stream) video.srcObject = null;
    };
  }, [stream]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => setContainerSize({ width: container.clientWidth, height: container.clientHeight });
    const frame = window.requestAnimationFrame(update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(container);
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, []);
  const source = snapshot.dimensions ?? { width: 0, height: 0 };
  const overlayCrop = crop && containerSize.width > 0 && source.width > 0
    ? mapSourceCropToOverlay(crop, containerSize, source)
    : undefined;
  const pointerPosition = (event: React.PointerEvent) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  return (
    <div ref={containerRef} className={`capture-preview ${stream ? 'has-stream' : ''}`}>
      {stream ? (
        <video ref={videoRef} autoPlay muted playsInline />
      ) : (
        <div className="capture-preview-empty">
          <span className="capture-preview-icon" aria-hidden="true" />
          <strong>No source selected</strong>
          <small>Choose a screen, window, or browser tab above.</small>
        </div>
      )}
      {snapshot.selectedSurface && (
        <span className="capture-preview-badge">
          {snapshot.selectedSurface} · {snapshot.dimensions?.width ?? 0}×{snapshot.dimensions?.height ?? 0}
        </span>
      )}
      {cropEnabled && stream && (
        <div
          className="capture-crop-overlay"
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragStart.current = pointerPosition(event);
            setDraft({ ...dragStart.current, width: 0, height: 0 });
          }}
          onPointerMove={event => {
            if (!dragStart.current) return;
            const point = pointerPosition(event);
            setDraft({
              x: Math.min(dragStart.current.x, point.x),
              y: Math.min(dragStart.current.y, point.y),
              width: Math.abs(point.x - dragStart.current.x),
              height: Math.abs(point.y - dragStart.current.y),
            });
          }}
          onPointerUp={event => {
            const selected = draft;
            dragStart.current = null;
            setDraft(undefined);
            if (!selected || selected.width < 4 || selected.height < 4) {
              onCropChange?.(undefined);
              return;
            }
            const container = event.currentTarget;
            onCropChange?.(mapOverlayCropToSource(selected, {
              width: container.clientWidth,
              height: container.clientHeight,
            }, source));
          }}
        >
          {(draft ?? overlayCrop) && <div className="capture-crop-selection" style={draft ?? overlayCrop} />}
        </div>
      )}
    </div>
  );
}
