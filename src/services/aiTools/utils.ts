// AI Tools Utilities

import { useTimelineStore } from '../../stores/timeline';
import { useSettingsStore } from '../../stores/settingsStore';
import { NativeHelperClient } from '../nativeHelper';
import { renderHostPort } from '../render/renderHostPort';
import type { TimelineClip, TimelineTrack } from '../../stores/timeline/types';
import type { ToolResult } from './types';
import {
  captureRenderHostFrame,
  type PreviewCaptureMode,
} from './previewCapture';

function waitForTimeout(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitForAnimationFrame(): Promise<number> {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(resolve);
      return;
    }
    setTimeout(() => resolve(performance.now()), 16);
  });
}

async function drawDataUrlToCanvas(
  ctx: CanvasRenderingContext2D,
  dataUrl: string,
  dx: number,
  dy: number,
  dw: number,
  dh: number
): Promise<void> {
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Failed to decode captured preview frame'));
    image.src = dataUrl;
  });
  ctx.drawImage(image, dx, dy, dw, dh);
}

// Helper to capture frames at multiple times and combine into a grid image
export async function captureFrameGrid(
  times: number[],
  columns: number,
  timelineStore: ReturnType<typeof useTimelineStore.getState>,
  options: { settleMs?: number; mode?: PreviewCaptureMode } = {}
): Promise<ToolResult> {
  const frameWidth = 320; // Thumbnail size
  const frameHeight = 180;
  const rows = Math.ceil(times.length / columns);
  const settleMs = Math.max(50, Math.min(1500, Math.round(options.settleMs ?? 140)));
  const mode = options.mode ?? 'auto';

  // Create canvas for the grid
  const gridCanvas = document.createElement('canvas');
  gridCanvas.width = frameWidth * columns;
  gridCanvas.height = frameHeight * rows;
  const gridCtx = gridCanvas.getContext('2d');

  if (!gridCtx) {
    return { success: false, error: 'Failed to create canvas context' };
  }

  // Fill with dark background
  gridCtx.fillStyle = '#1a1a1a';
  gridCtx.fillRect(0, 0, gridCanvas.width, gridCanvas.height);

  const originalPosition = timelineStore.playheadPosition;

  try {
    // Capture each frame
    for (let i = 0; i < times.length; i++) {
      const time = times[i];
      const col = i % columns;
      const row = Math.floor(i / columns);

      // Move playhead and give nested video providers enough time to settle.
      timelineStore.setPlayheadPosition(Math.max(0, time));
      renderHostPort.requestRender();
      await waitForAnimationFrame();
      await waitForTimeout(settleMs);
      renderHostPort.requestRender();
      await waitForAnimationFrame();

      const capture = await captureRenderHostFrame(mode);
      if (!capture.success) {
        return {
          success: false,
          error: capture.error,
          data: {
            frameTime: time,
            requestedMode: mode,
          },
        };
      }
      await drawDataUrlToCanvas(
        gridCtx,
        capture.dataUrl,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight
      );

      // Draw time label
      gridCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      gridCtx.fillRect(col * frameWidth, row * frameHeight + frameHeight - 20, frameWidth, 20);
      gridCtx.fillStyle = '#ffffff';
      gridCtx.font = '12px monospace';
      gridCtx.fillText(
        `${time.toFixed(2)}s`,
        col * frameWidth + 5,
        row * frameHeight + frameHeight - 6
      );

      // Draw separator line between "before" and "after" rows if this is a cut preview
      if (i === columns - 1 && rows === 2) {
        gridCtx.strokeStyle = '#ff4444';
        gridCtx.lineWidth = 2;
        gridCtx.beginPath();
        gridCtx.moveTo(0, frameHeight);
        gridCtx.lineTo(gridCanvas.width, frameHeight);
        gridCtx.stroke();
      }
    }

    // Convert to PNG
    const dataUrl = gridCanvas.toDataURL('image/png');

    return {
      success: true,
      data: {
        width: gridCanvas.width,
        height: gridCanvas.height,
        frameCount: times.length,
        gridSize: `${columns}x${rows}`,
        requestedMode: mode,
        dataUrl,
      },
    };
  } finally {
    timelineStore.setPlayheadPosition(originalPosition);
    renderHostPort.requestRender();
  }
}

// Helper to format clip info for AI
export function formatClipInfo(clip: TimelineClip, track: TimelineTrack | undefined) {
  return {
    id: clip.id,
    name: clip.name,
    trackId: clip.trackId,
    trackName: track?.name || 'Unknown',
    trackType: track?.type || 'unknown',
    startTime: clip.startTime,
    endTime: clip.startTime + clip.duration,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    speed: clip.speed ?? 1,
    reversed: clip.reversed ?? false,
    sourceType: clip.source?.type,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    transitionIn: clip.transitionIn ? { ...clip.transitionIn } : undefined,
    transitionOut: clip.transitionOut ? { ...clip.transitionOut } : undefined,
    hasAnalysis: clip.analysisStatus === 'ready',
    hasTranscript: clip.transcriptStatus === 'ready' || !!clip.transcript?.length,
    // Transform info
    transform: clip.transform,
    // Effects count
    effectsCount: clip.effects?.length || 0,
  };
}

// Helper to format track info for AI
export function formatTrackInfo(track: TimelineTrack, clips: TimelineClip[]) {
  const trackClips = clips.filter(c => c.trackId === track.id);
  return {
    id: track.id,
    name: track.name,
    type: track.type,
    visible: track.visible,
    muted: track.muted,
    solo: track.solo,
    clipCount: trackClips.length,
    clips: trackClips.map(c => ({
      id: c.id,
      name: c.name,
      startTime: c.startTime,
      endTime: c.startTime + c.duration,
      duration: c.duration,
      sourceType: c.source?.type,
      signalAssetId: c.signalAssetId,
      signalRefId: c.signalRefId,
      signalRenderAdapterId: c.signalRenderAdapterId,
      transitionIn: c.transitionIn ? { ...c.transitionIn } : undefined,
      transitionOut: c.transitionOut ? { ...c.transitionOut } : undefined,
      hasAnalysis: c.analysisStatus === 'ready',
      hasTranscript: c.transcriptStatus === 'ready' || !!c.transcript?.length,
    })),
  };
}

// Helper to get a quick summary for AI context
export function getQuickTimelineSummary(): string {
  const { tracks, clips, playheadPosition, duration, selectedClipIds } = useTimelineStore.getState();

  const videoTracks = tracks.filter(t => t.type === 'video');
  const audioTracks = tracks.filter(t => t.type === 'audio');
  const videoClips = clips.filter(c => videoTracks.some(t => t.id === c.trackId));
  const audioClips = clips.filter(c => audioTracks.some(t => t.id === c.trackId));

  // Selected clip info
  const selectedCount = selectedClipIds.size;
  let selectedInfo = '';
  if (selectedCount > 0) {
    const selectedClip = clips.find(c => selectedClipIds.has(c.id));
    if (selectedClip) {
      const track = tracks.find(t => t.id === selectedClip.trackId);
      selectedInfo = ` Selected: "${selectedClip.name}" on ${track?.name || 'unknown track'}.`;
      if (selectedCount > 1) {
        selectedInfo = ` ${selectedCount} clips selected, first: "${selectedClip.name}" on ${track?.name || 'unknown track'}.`;
      }
    }
  }

  // YouTube / NativeHelper status
  const nativeConnected = NativeHelperClient.isConnected();
  const hasYouTubeKey = !!useSettingsStore.getState().apiKeys.youtube;
  const ytStatus = nativeConnected
    ? `Native Helper: connected (downloads available).`
    : `Native Helper: not connected (downloads unavailable).`;
  const ytKeyStatus = hasYouTubeKey ? '' : ' YouTube API key not set.';

  return `Timeline: ${videoTracks.length} video tracks (${videoClips.length} clips), ${audioTracks.length} audio tracks (${audioClips.length} clips). Playhead at ${playheadPosition.toFixed(2)}s, duration ${duration.toFixed(2)}s.${selectedInfo} ${ytStatus}${ytKeyStatus}`;
}
