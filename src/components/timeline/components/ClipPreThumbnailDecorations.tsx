import { memo, type ComponentProps } from 'react';
import type { TimelineClip } from '../../../types';
import { StaticClipIcon } from './ClipPresentationPrimitives';
import { ClipWaveform } from './ClipWaveform';

interface ClipPreThumbnailDecorationsProps {
  enabled: boolean;
  clip: TimelineClip;
  waveformsEnabled: boolean;
  width: number;
  trackBaseHeight: number;
  displayInPoint: number;
  displayOutPoint: number;
  audioDisplayMode: ComponentProps<typeof ClipWaveform>['displayMode'];
  pixelsPerSecond: number;
  waveformRenderStartPx: number;
  waveformRenderWidth: number;
  staticClipIconKind: ComponentProps<typeof StaticClipIcon>['kind'] | null;
}

export const ClipPreThumbnailDecorations = memo(function ClipPreThumbnailDecorations({
  enabled,
  clip,
  waveformsEnabled,
  width,
  trackBaseHeight,
  displayInPoint,
  displayOutPoint,
  audioDisplayMode,
  pixelsPerSecond,
  waveformRenderStartPx,
  waveformRenderWidth,
  staticClipIconKind,
}: ClipPreThumbnailDecorationsProps) {
  if (!enabled) return null;

  return (
    <>
      {waveformsEnabled && clip.isComposition && clip.mixdownWaveform && clip.mixdownWaveform.length > 0 && (
        <div className="clip-mixdown-waveform">
          <ClipWaveform
            waveform={clip.mixdownWaveform}
            width={width}
            height={Math.min(42, Math.max(16, trackBaseHeight / 3))}
            inPoint={displayInPoint}
            outPoint={displayOutPoint}
            naturalDuration={clip.duration}
            displayMode={audioDisplayMode}
            pixelsPerSecond={pixelsPerSecond}
            renderStartPx={waveformRenderStartPx}
            renderWidth={waveformRenderWidth}
          />
        </div>
      )}
      {clip.isComposition && clip.mixdownGenerating && (
        <div className="clip-mixdown-indicator">
          <span>Generating audio...</span>
        </div>
      )}
      {staticClipIconKind && (
        <div className="clip-static-artwork" aria-hidden="true">
          <StaticClipIcon kind={staticClipIconKind} className="clip-static-artwork-icon" />
        </div>
      )}
    </>
  );
});
