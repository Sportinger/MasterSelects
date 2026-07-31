import { useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { renderStoryboardAnimaticPreviewFrame } from '../../../services/storyboard/animatic/previewAdapter';
import { resolveStoryboardCandidateAwareAnimaticFramePayload } from '../../../services/storyboard/animaticCandidates';
import { useMediaStore } from '../../../stores/mediaStore';
import { useStoryboardStore } from '../../../stores/storyboardStore';
import { useTimelineStore } from '../../../stores/timeline';

export interface StoryboardAnimaticPreviewOverlayProps {
  readonly displayedCompositionId: string | null;
  readonly width: number;
  readonly height: number;
  readonly displayWidth: number;
  readonly displayHeight: number;
}

export function StoryboardAnimaticPreviewOverlay({
  displayedCompositionId,
  width,
  height,
  displayWidth,
  displayHeight,
}: StoryboardAnimaticPreviewOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { clips, tracks, playheadPosition, isExporting } = useTimelineStore(useShallow(state => ({
    clips: state.clips,
    tracks: state.tracks,
    playheadPosition: state.playheadPosition,
    isExporting: state.isExporting,
  })));
  const { activeCompositionId, mediaFiles } = useMediaStore(useShallow(state => ({
    activeCompositionId: state.activeCompositionId,
    mediaFiles: state.files,
  })));
  const storyboardState = useStoryboardStore();
  const isActiveComposition = !displayedCompositionId || displayedCompositionId === activeCompositionId;
  const payload = useMemo(() => {
    if (!isActiveComposition || isExporting) return null;
    return resolveStoryboardCandidateAwareAnimaticFramePayload({
      clips,
      tracks,
      mediaFiles,
      time: playheadPosition,
      width,
      height,
      mode: 'preview',
      cameraMove: 'push-in',
      state: storyboardState,
    });
  }, [
    clips,
    height,
    isActiveComposition,
    isExporting,
    mediaFiles,
    playheadPosition,
    storyboardState,
    tracks,
    width,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context || !payload || payload.kind === 'real-media') return;
    let cancelled = false;

    if (payload.kind === 'still-image' && payload.still) {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => {
        if (!cancelled) renderStoryboardAnimaticPreviewFrame(context, payload, image);
      };
      image.src = payload.still.imageUrl;
    } else {
      renderStoryboardAnimaticPreviewFrame(context, payload);
    }
    return () => {
      cancelled = true;
      context.clearRect(0, 0, canvas.width, canvas.height);
    };
  }, [payload]);

  if (!payload || payload.kind === 'real-media') return null;
  const label = payload.kind === 'slate'
    ? `Storyboard scene slate: ${payload.slate?.title ?? payload.sceneId}`
    : `Storyboard still-image animatic: ${payload.sceneId}`;

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      role="img"
      aria-label={label}
      data-storyboard-animatic-kind={payload.kind}
      style={{
        position: 'absolute',
        inset: 0,
        width: displayWidth,
        height: displayHeight,
        pointerEvents: 'none',
      }}
    />
  );
}
