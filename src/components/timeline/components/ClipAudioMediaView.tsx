import { memo, type ComponentProps } from 'react';
import type { TimelineAudioDisplayMode } from '../../../stores/timeline/types';
import type { AudioAnalysisDisplayStatus } from '../utils/audioAnalysisDisplayStatus';
import type { AudioWaveformDiagnostics } from '../utils/audioWaveformDiagnostics';
import { ClipSpectrogram } from './ClipSpectrogram';
import { ClipWaveform } from './ClipWaveform';

interface ClipAudioMediaViewProps {
  audioDisplayMode: TimelineAudioDisplayMode;
  hasWaveformForRender: boolean;
  spectrogramProps: ComponentProps<typeof ClipSpectrogram>;
  waveformProps: ComponentProps<typeof ClipWaveform>;
  audioAnalysisDisplayStatus: AudioAnalysisDisplayStatus | null;
  audioWaveformDiagnostics: AudioWaveformDiagnostics | null;
}

export const ClipAudioMediaView = memo(function ClipAudioMediaView({
  audioDisplayMode,
  hasWaveformForRender,
  spectrogramProps,
  waveformProps,
  audioAnalysisDisplayStatus,
  audioWaveformDiagnostics,
}: ClipAudioMediaViewProps) {
  return (
    <div className="clip-waveform">
      {audioDisplayMode === 'spectral' && spectrogramProps.tileSet ? (
        <ClipSpectrogram {...spectrogramProps} />
      ) : audioDisplayMode === 'spectral' ? (
        <div className="spectrogram-pending" />
      ) : hasWaveformForRender ? (
        <ClipWaveform {...waveformProps} />
      ) : null}
      {(audioAnalysisDisplayStatus || (audioWaveformDiagnostics?.badges.length ?? 0) > 0) && (
        <div className="clip-audio-status-stack">
          {audioAnalysisDisplayStatus && (
            <div
              className={`clip-audio-analysis-status clip-audio-analysis-status-${audioAnalysisDisplayStatus.kind}`}
              title={audioAnalysisDisplayStatus.title}
              data-audio-analysis-status={audioAnalysisDisplayStatus.kind}
            >
              {audioAnalysisDisplayStatus.label}
            </div>
          )}
          {audioWaveformDiagnostics?.badges.map((badge) => (
            <div
              key={badge.kind}
              className={`clip-audio-diagnostic-badge ${badge.className}`}
              title={badge.title}
              data-audio-diagnostic={badge.kind}
              data-audio-diagnostic-source={audioWaveformDiagnostics.source}
            >
              {badge.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
