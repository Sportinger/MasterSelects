import { describe, expect, it } from 'vitest';
import {
  resolveAudioWaveformDiagnostics,
  type ResolveAudioWaveformDiagnosticsInput,
} from '../../src/components/timeline/utils/audioWaveformDiagnostics';
import type { TimelineWaveformPyramid } from '../../src/components/timeline/utils/waveformLod';

function createPyramid(peaks: number[], rms = peaks.map(value => value * 0.5)): TimelineWaveformPyramid {
  return {
    sampleRate: 48_000,
    duration: peaks.length,
    levels: [
      {
        samplesPerBucket: 48_000,
        bucketDuration: 1,
        bucketCount: peaks.length,
        channels: [{
          channelIndex: 0,
          min: peaks.map(value => -value),
          max: peaks,
          rms,
          peak: peaks,
        }],
      },
    ],
  };
}

function diagnose(input: Partial<ResolveAudioWaveformDiagnosticsInput>) {
  return resolveAudioWaveformDiagnostics({
    inPoint: 0,
    outPoint: 4,
    naturalDuration: 4,
    ...input,
  });
}

describe('audioWaveformDiagnostics', () => {
  it('flags clipping from true pyramid peak data', () => {
    const diagnostics = diagnose({
      pyramid: createPyramid([0.2, 0.99, 1, 0.25]),
    });

    expect(diagnostics).toMatchObject({
      source: 'pyramid',
      clipping: true,
      silence: false,
    });
    expect(diagnostics?.classNames).toContain('audio-diagnostic-clipping');
    expect(diagnostics?.badges[0]).toMatchObject({ kind: 'clipping', label: 'CLIP' });
  });

  it('uses gain for approximate source output clipping without requiring reanalysis', () => {
    const diagnostics = diagnose({
      pyramid: createPyramid([0.52, 0.55, 0.57, 0.56]),
      gain: 2,
    });

    expect(diagnostics).toMatchObject({
      clipping: true,
      source: 'pyramid',
    });
  });

  it('treats zero output gain as silence instead of preserving source clipping', () => {
    const diagnostics = diagnose({
      pyramid: createPyramid([1, 1, 0.98, 1]),
      gain: 0,
    });

    expect(diagnostics).toMatchObject({
      clipping: false,
      silence: true,
      source: 'pyramid',
    });
  });

  it('does not treat normalized legacy thumbnails as clipping evidence', () => {
    const diagnostics = diagnose({
      waveform: [0, 0.3, 1, 0.4],
    });

    expect(diagnostics).toBeNull();
  });

  it('flags digital silence from legacy thumbnails only when the range is effectively zero', () => {
    const diagnostics = diagnose({
      waveform: [0, 0, 0, 0],
    });

    expect(diagnostics).toMatchObject({
      source: 'legacy',
      clipping: false,
      silence: true,
    });
    expect(diagnostics?.classNames).toContain('audio-diagnostic-silence');
  });

  it('respects trimmed pyramid ranges', () => {
    const diagnostics = diagnose({
      pyramid: createPyramid([1, 0.1, 0.1, 0.1]),
      inPoint: 1,
      outPoint: 4,
    });

    expect(diagnostics).toBeNull();
  });
});
