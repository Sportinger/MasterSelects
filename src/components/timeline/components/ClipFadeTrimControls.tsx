import { memo, type ComponentProps } from 'react';
import type { TrimHandleArrowDirection } from '../utils/trimHandleDirections';
import { FadeCurve } from './FadeCurve';
import { TrimHandleArrows } from './ClipPresentationPrimitives';

interface ClipFadeTrimControlsProps {
  fadeCurveKey: string;
  fadeCurveKeyframes: ComponentProps<typeof FadeCurve>['keyframes'];
  displayDuration: number;
  width: number;
  trackBaseHeight: number;
  isAudioClip: boolean;
  isTrackLocked: boolean;
  canUseFadeHandles: boolean;
  canUseTrimHandles: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  timeToPixel: (time: number) => number;
  leftTrimHandleDirections: readonly TrimHandleArrowDirection[];
  rightTrimHandleDirections: readonly TrimHandleArrowDirection[];
  onFadeStart: (e: React.MouseEvent, edge: 'left' | 'right') => void;
  onTrimStart: (e: React.MouseEvent, edge: 'left' | 'right') => void;
}

export const ClipFadeTrimControls = memo(function ClipFadeTrimControls({
  fadeCurveKey,
  fadeCurveKeyframes,
  displayDuration,
  width,
  trackBaseHeight,
  isAudioClip,
  isTrackLocked,
  canUseFadeHandles,
  canUseTrimHandles,
  fadeInDuration,
  fadeOutDuration,
  timeToPixel,
  leftTrimHandleDirections,
  rightTrimHandleDirections,
  onFadeStart,
  onTrimStart,
}: ClipFadeTrimControlsProps) {
  return (
    <>
      {fadeCurveKeyframes.length >= 2 && (
        <div
          className={`fade-curve-container ${isAudioClip ? 'audio-automation-curve-container' : ''}`}
          data-audio-automation-curve={isAudioClip ? 'volume' : undefined}
        >
          <FadeCurve
            key={fadeCurveKey}
            keyframes={fadeCurveKeyframes}
            clipDuration={displayDuration}
            width={width}
            height={trackBaseHeight}
          />
        </div>
      )}
      {!isTrackLocked && (
        <>
          <div
            className={`fade-handle left${fadeInDuration > 0 ? ' active' : ''}`}
            style={fadeInDuration > 0 ? { left: timeToPixel(fadeInDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'left');
            }}
            title={fadeInDuration > 0 ? `Fade In: ${fadeInDuration.toFixed(2)}s` : 'Drag to add fade in'}
          />
          <div
            className={`fade-handle right${fadeOutDuration > 0 ? ' active' : ''}`}
            style={fadeOutDuration > 0 ? { right: timeToPixel(fadeOutDuration) - 6 } : undefined}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseFadeHandles) return;
              e.stopPropagation();
              onFadeStart(e, 'right');
            }}
            title={fadeOutDuration > 0 ? `Fade Out: ${fadeOutDuration.toFixed(2)}s` : 'Drag to add fade out'}
          />
          <div
            className={`trim-handle left arrows-${leftTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'left');
            }}
          >
            <TrimHandleArrows directions={[...leftTrimHandleDirections]} />
          </div>
          <div
            className={`trim-handle right arrows-${rightTrimHandleDirections.length}`}
            onMouseDown={(e) => {
              if (e.button !== 0) return;
              if (!canUseTrimHandles) return;
              e.stopPropagation();
              onTrimStart(e, 'right');
            }}
          >
            <TrimHandleArrows directions={[...rightTrimHandleDirections]} />
          </div>
        </>
      )}
    </>
  );
});
