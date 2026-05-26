import { describe, expect, it } from 'vitest';
import { resolveProcessedAudioAnalysisDisplayStatus } from '../../src/components/timeline/utils/audioAnalysisDisplayStatus';

describe('audioAnalysisDisplayStatus', () => {
  it('does not flag current source views that do not need processed analysis', () => {
    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'waveform',
      needsProcessed: false,
      processedReady: false,
      fallbackAvailable: true,
      loadStatus: 'idle',
    })).toBeNull();
  });

  it('does not flag loaded processed artifacts', () => {
    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'spectrogram',
      needsProcessed: true,
      processedRef: 'processed-spectrum',
      processedReady: true,
      fallbackAvailable: true,
      loadStatus: 'ready',
    })).toBeNull();
  });

  it('marks source fallback views as approximate when processed analysis is required', () => {
    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'waveform',
      needsProcessed: true,
      processedReady: false,
      fallbackAvailable: true,
      loadStatus: 'idle',
      autoGenerateEligible: true,
    })).toMatchObject({
      kind: 'approximate-source',
      className: 'waveform-processed-approximate-source',
      label: 'SRC',
    });
  });

  it('marks referenced but not loaded processed artifacts as pending', () => {
    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'spectrogram',
      needsProcessed: true,
      processedRef: 'processed-spectrum',
      processedReady: false,
      fallbackAvailable: false,
      loadStatus: 'loading',
    })).toMatchObject({
      kind: 'pending',
      className: 'spectrogram-processed-pending',
      label: 'PEND',
    });
  });

  it('surfaces missing and failed processed artifacts distinctly', () => {
    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'waveform',
      needsProcessed: true,
      processedRef: 'processed-waveform',
      processedReady: false,
      fallbackAvailable: false,
      loadStatus: 'missing',
    })).toMatchObject({
      kind: 'missing',
      label: 'MISS',
    });

    expect(resolveProcessedAudioAnalysisDisplayStatus({
      artifactLabel: 'waveform',
      needsProcessed: true,
      processedRef: 'processed-waveform',
      processedReady: false,
      fallbackAvailable: false,
      loadStatus: 'error',
    })).toMatchObject({
      kind: 'error',
      label: 'ERR',
    });
  });
});
