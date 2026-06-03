import { useMemo } from 'react';
import type { ComponentProps } from 'react';
import { ClipSpectrogram } from '../components/ClipSpectrogram';
import { ClipWaveform } from '../components/ClipWaveform';
import type { TimelineHorizontalRenderWindow } from '../utils/waveformRenderGeometry';

type ClipAudioSpectrogramProps = ComponentProps<typeof ClipSpectrogram>;
type ClipAudioWaveformProps = ComponentProps<typeof ClipWaveform>;

export interface ClipAudioMediaViewPropsPlan {
  audioSpectrogramProps: ClipAudioSpectrogramProps;
  audioWaveformProps: ClipAudioWaveformProps;
}

export function useClipAudioMediaViewProps(input: {
  clipId: string;
  trackBaseHeight: number;
  width: number;
  zoom: number;
  audioDisplayMode: ClipAudioWaveformProps['displayMode'];
  spectrogramTileSet: ClipAudioSpectrogramProps['tileSet'];
  spectrogramInPoint: number;
  spectrogramOutPoint: number;
  spectrogramNaturalDuration: number;
  spectrogramVariant: ClipAudioSpectrogramProps['variant'];
  waveformRenderWindow: TimelineHorizontalRenderWindow;
  waveformLegacyForRender: ClipAudioWaveformProps['waveform'];
  waveformChannelsForRender: ClipAudioWaveformProps['waveformChannels'];
  waveformNaturalDurationForRender: number;
  waveformPyramidForRender: ClipAudioWaveformProps['pyramid'];
  waveformVariantForRender: ClipAudioWaveformProps['waveformVariant'];
  waveformDisplayGainForRender: number;
  stableWaveformContentWidth: number;
  stableWaveformContentInPoint: number;
  stableWaveformContentOutPoint: number;
  stableWaveformClipDuration: number;
  stableWaveformRenderWindow: TimelineHorizontalRenderWindow;
  stableWaveformContentOffsetPx: number;
  audioVolumeAutomationKeyframes: ClipAudioWaveformProps['volumeAutomationKeyframes'];
  predictiveAudioEditStack: ClipAudioWaveformProps['audioEditStack'];
  predictiveAudioRegionGainPreview: ClipAudioWaveformProps['audioRegionGainPreview'];
  useStableWaveformTrimWindow: boolean;
  originalWaveformTrimInPoint: number;
  originalWaveformTrimOutPoint: number;
  waveformSourceSecondsPerPixel: number;
}): ClipAudioMediaViewPropsPlan {
  const audioMediaHeight = Math.max(20, input.trackBaseHeight - 12);
  const waveformNormalizationInPoint = input.useStableWaveformTrimWindow ? input.originalWaveformTrimInPoint : undefined;
  const waveformNormalizationOutPoint = input.useStableWaveformTrimWindow ? input.originalWaveformTrimOutPoint : undefined;
  const waveformNormalizationWidth = input.useStableWaveformTrimWindow
    ? Math.max(1, (input.originalWaveformTrimOutPoint - input.originalWaveformTrimInPoint) / input.waveformSourceSecondsPerPixel)
    : undefined;

  const audioSpectrogramProps = useMemo<ClipAudioSpectrogramProps>(() => ({
    tileSet: input.spectrogramTileSet,
    width: input.width,
    height: audioMediaHeight,
    inPoint: input.spectrogramInPoint,
    outPoint: input.spectrogramOutPoint,
    naturalDuration: input.spectrogramNaturalDuration,
    renderStartPx: input.waveformRenderWindow.startPx,
    renderWidth: input.waveformRenderWindow.width,
    variant: input.spectrogramVariant,
  }), [
    audioMediaHeight,
    input.spectrogramInPoint,
    input.spectrogramNaturalDuration,
    input.spectrogramOutPoint,
    input.spectrogramTileSet,
    input.spectrogramVariant,
    input.waveformRenderWindow.startPx,
    input.waveformRenderWindow.width,
    input.width,
  ]);

  const audioWaveformProps = useMemo<ClipAudioWaveformProps>(() => ({
    clipId: input.clipId,
    waveform: input.waveformLegacyForRender,
    waveformChannels: input.waveformChannelsForRender,
    width: input.stableWaveformContentWidth,
    height: audioMediaHeight,
    inPoint: input.stableWaveformContentInPoint,
    outPoint: input.stableWaveformContentOutPoint,
    naturalDuration: input.waveformNaturalDurationForRender,
    clipDuration: input.stableWaveformClipDuration,
    displayMode: input.audioDisplayMode,
    pixelsPerSecond: input.zoom,
    pyramid: input.waveformPyramidForRender,
    waveformVariant: input.waveformVariantForRender,
    displayGain: input.waveformDisplayGainForRender,
    volumeAutomationKeyframes: input.audioVolumeAutomationKeyframes,
    audioEditStack: input.predictiveAudioEditStack,
    audioRegionGainPreview: input.predictiveAudioRegionGainPreview,
    renderStartPx: input.stableWaveformRenderWindow.startPx,
    renderWidth: input.stableWaveformRenderWindow.width,
    contentOffsetPx: input.stableWaveformContentOffsetPx,
    normalizationInPoint: waveformNormalizationInPoint,
    normalizationOutPoint: waveformNormalizationOutPoint,
    normalizationWidth: waveformNormalizationWidth,
  }), [
    audioMediaHeight,
    input.audioDisplayMode,
    input.audioVolumeAutomationKeyframes,
    input.clipId,
    input.predictiveAudioEditStack,
    input.predictiveAudioRegionGainPreview,
    input.stableWaveformClipDuration,
    input.stableWaveformContentInPoint,
    input.stableWaveformContentOffsetPx,
    input.stableWaveformContentOutPoint,
    input.stableWaveformContentWidth,
    input.stableWaveformRenderWindow.startPx,
    input.stableWaveformRenderWindow.width,
    input.waveformChannelsForRender,
    input.waveformDisplayGainForRender,
    input.waveformLegacyForRender,
    input.waveformNaturalDurationForRender,
    input.waveformPyramidForRender,
    input.waveformVariantForRender,
    input.zoom,
    waveformNormalizationInPoint,
    waveformNormalizationOutPoint,
    waveformNormalizationWidth,
  ]);

  return {
    audioSpectrogramProps,
    audioWaveformProps,
  };
}
