import { useEffect, useRef } from 'react';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';
import { FileTypeIcon } from './FileTypeIcon';
import {
  drawSourceAudioWaveformCanvas,
  getAudioWaveformStatus,
  getSourceWaveformChannels,
} from '../../preview/sourceAudioWaveform';

interface MediaWaveformThumbProps {
  mediaFile: MediaFile;
}

// Light fill so the (otherwise near-black) waveform is visible on the dark thumb.
const THUMB_WAVEFORM_FILL = 'rgba(255, 255, 255, 0.62)';

/**
 * Detailed waveform preview for audio files in the grid/slot and board views
 * (#202 — visual only, no audio playback). Reuses the same waveform renderer as
 * the Source Monitor so it matches the already-rendered waveforms elsewhere.
 */
export function MediaWaveformThumb({ mediaFile }: MediaWaveformThumbProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const generateMediaWaveform = useMediaStore((s) => s.generateMediaWaveform);

  const channels = getSourceWaveformChannels(mediaFile);
  const hasWaveform = channels.length > 0;
  const status = getAudioWaveformStatus(mediaFile, true);

  // Kick off waveform generation once if we have nothing to draw yet, but defer
  // it to idle and CANCEL on unmount. This keeps view switches snappy: rapidly
  // switching views unmounts these thumbs before generation ever starts, so we
  // never fire a burst of audio-decodes mid-transition (#202 perf follow-up).
  useEffect(() => {
    if (hasWaveform || status === 'generating' || status === 'error') return undefined;
    let cancelled = false;
    const run = () => { if (!cancelled) void generateMediaWaveform(mediaFile.id); };
    const idleWin = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout?: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    const idleId = typeof idleWin.requestIdleCallback === 'function'
      ? idleWin.requestIdleCallback(run, { timeout: 2000 })
      : window.setTimeout(run, 500);
    return () => {
      cancelled = true;
      if (typeof idleWin.cancelIdleCallback === 'function') idleWin.cancelIdleCallback(idleId);
      window.clearTimeout(idleId);
    };
  }, [hasWaveform, status, mediaFile.id, generateMediaWaveform]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !hasWaveform) return undefined;

    const draw = () => drawSourceAudioWaveformCanvas(canvas, channels, status, THUMB_WAVEFORM_FILL);
    draw();
    // Debounce resize redraws so view-switch animations stay smooth (the canvas
    // stretches in the meantime, then crisp-redraws once settled).
    let debounceTimer = 0;
    const scheduleDraw = () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(draw, 140);
    };
    const observer = new ResizeObserver(scheduleDraw);
    if (canvas.parentElement) observer.observe(canvas.parentElement);
    return () => {
      if (debounceTimer) window.clearTimeout(debounceTimer);
      observer.disconnect();
    };
  }, [channels, hasWaveform, status]);

  if (!hasWaveform) {
    return (
      <div className="media-waveform-thumb">
        <div className="media-grid-thumb-placeholder">
          <FileTypeIcon type="audio" large />
        </div>
      </div>
    );
  }

  return (
    <div className="media-waveform-thumb">
      <canvas ref={canvasRef} className="media-waveform-canvas" />
    </div>
  );
}
