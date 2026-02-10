// MiniTimeline - Lightweight canvas renderer for slot grid composition miniatures
// Draws simplified timeline view: colored clip rectangles, waveform bars, track lanes

import { useRef, useEffect, memo } from 'react';
import type { CompositionTimelineData } from '../../types';

interface MiniTimelineProps {
  timelineData: CompositionTimelineData | undefined;
  compositionName: string;
  compositionDuration: number;
  isActive: boolean;
  width: number;
  height: number;
}

// Clip type → color mapping
const CLIP_COLORS: Record<string, string> = {
  video: '#4a9eff',
  image: '#9b59b6',
  text: '#e67e22',
  solid: '#95a5a6',
  audio: '#2ecc71',
};

function MiniTimelineInner({
  timelineData,
  compositionName,
  compositionDuration,
  isActive,
  width,
  height,
}: MiniTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(0, 0, width, height);

    if (!timelineData || !timelineData.tracks || !timelineData.clips) {
      // Empty composition - just show name
      drawLabel(ctx, compositionName, width);
      return;
    }

    const { tracks, clips } = timelineData;
    const duration = compositionDuration || timelineData.duration || 60;

    // Layout: leave space for label at top and padding
    const labelHeight = 16;
    const padding = 3;
    const trackAreaTop = labelHeight + padding;
    const trackAreaHeight = height - trackAreaTop - padding;

    if (tracks.length === 0 || trackAreaHeight <= 0) {
      drawLabel(ctx, compositionName, width);
      return;
    }

    // Calculate track heights proportionally
    const trackHeight = Math.max(4, trackAreaHeight / tracks.length);
    const trackGap = Math.max(1, Math.min(2, (trackAreaHeight - trackHeight * tracks.length) / Math.max(1, tracks.length - 1)));

    // Draw track lanes
    tracks.forEach((track, i) => {
      const y = trackAreaTop + i * (trackHeight + trackGap);

      // Track lane background
      ctx.fillStyle = track.type === 'video' ? '#222' : '#1e1e1e';
      ctx.fillRect(padding, y, width - padding * 2, trackHeight);
    });

    // Draw clips
    clips.forEach((clip) => {
      const trackIndex = tracks.findIndex(t => t.id === clip.trackId);
      if (trackIndex === -1) return;

      const y = trackAreaTop + trackIndex * (trackHeight + trackGap);
      const x = padding + (clip.startTime / duration) * (width - padding * 2);
      const w = Math.max(2, (clip.duration / duration) * (width - padding * 2));

      const clipColor = clip.sourceType === 'solid' && clip.transform
        ? '#95a5a6'
        : CLIP_COLORS[clip.sourceType] || '#4a9eff';

      // Clip rectangle
      ctx.fillStyle = clipColor;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(x, y + 1, w, trackHeight - 2);
      ctx.globalAlpha = 1;

      // Waveform bars for audio clips
      if (clip.sourceType === 'audio' && clip.waveform && clip.waveform.length > 0) {
        drawWaveform(ctx, clip.waveform, x, y + 1, w, trackHeight - 2);
      }
    });

    // Draw playhead for active composition
    if (isActive && timelineData.playheadPosition !== undefined) {
      const playheadX = padding + (timelineData.playheadPosition / duration) * (width - padding * 2);
      ctx.strokeStyle = '#ff3b3b';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(playheadX, trackAreaTop);
      ctx.lineTo(playheadX, height - padding);
      ctx.stroke();
    }

    // Draw composition name label
    drawLabel(ctx, compositionName, width);
  }, [timelineData, compositionName, compositionDuration, isActive, width, height]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width, height, display: 'block' }}
    />
  );
}

function drawLabel(ctx: CanvasRenderingContext2D, name: string, width: number) {
  ctx.fillStyle = '#ccc';
  ctx.font = '10px system-ui, -apple-system, sans-serif';
  ctx.textBaseline = 'top';

  // Truncate if too long
  let displayName = name;
  const maxWidth = width - 8;
  while (ctx.measureText(displayName).width > maxWidth && displayName.length > 3) {
    displayName = displayName.slice(0, -1);
  }
  if (displayName !== name) displayName += '…';

  ctx.fillText(displayName, 4, 3);
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  waveform: number[],
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const barCount = Math.min(waveform.length, Math.floor(w / 2));
  if (barCount <= 0) return;

  const step = waveform.length / barCount;
  const barWidth = Math.max(1, w / barCount - 0.5);

  ctx.fillStyle = 'rgba(46, 204, 113, 0.6)';

  for (let i = 0; i < barCount; i++) {
    const sampleIdx = Math.floor(i * step);
    const amplitude = Math.abs(waveform[sampleIdx] || 0);
    const barHeight = Math.max(1, amplitude * h * 0.8);
    const barX = x + (i / barCount) * w;
    const barY = y + (h - barHeight) / 2;

    ctx.fillRect(barX, barY, barWidth, barHeight);
  }
}

export const MiniTimeline = memo(MiniTimelineInner);
