import { describe, expect, it, vi } from 'vitest';
import type { TimelineClip } from '../../src/types';
import { chooseExcerptWindow, energyCurveFromPyramid } from '../../src/services/audio/syncExcerptWindow';
import { audioSync } from '../../src/services/audioSync';

const signals = new Map<string, { samples: Float32Array; offsetSeconds: number }>();

vi.mock('../../src/services/audio/syncSignalSource', () => {
  return {
    accumulatePeakBins: vi.fn(),
    loadStreamedSyncSignal: vi.fn(async ({ clip, excerptSeconds }: { clip: TimelineClip; excerptSeconds?: number }) => {
      const signal = signals.get(clip.id);
      if (!signal) return null;
      // The master is always requested whole; targets ask for an excerpt.
      expect(excerptSeconds === undefined).toBe(clip.id === 'master');
      return signal;
    }),
  };
});

// The whole-buffer decode path is not exercised here.
vi.mock('../../src/services/audio/ClipAudioAnalysisOrchestrator', () => ({ prepareClipAudioAnalysisInput: vi.fn() }));

function noise(seconds: number, rate: number, seed: number): Float32Array {
  let state = seed;
  return Float32Array.from({ length: seconds * rate }, () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296 - 0.5;
  });
}

function clip(id: string, duration: number): TimelineClip {
  return {
    id,
    name: id,
    trackId: 'a',
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: { type: 'audio', mediaFileId: `media-${id}` },
  } as TimelineClip;
}

describe('excerpt window from a saved waveform', () => {
  it('uses the coarsest pyramid level under one second and picks the loudest window', () => {
    const rms = Float32Array.from({ length: 600 }, (_, index) => (index >= 300 && index < 360 ? 1 : 0.01));
    const curve = energyCurveFromPyramid({
      sampleRate: 3000,
      duration: 600,
      levels: [
        { samplesPerBucket: 32, bucketDuration: 0.01, bucketCount: 1, channels: [{ channelIndex: 0, min: [], max: [], rms: [0], peak: [] }] },
        { samplesPerBucket: 3000, bucketDuration: 1, bucketCount: 600, channels: [{ channelIndex: 0, min: [], max: [], rms, peak: [] }] },
        { samplesPerBucket: 8192, bucketDuration: 2.7, bucketCount: 222, channels: [{ channelIndex: 0, min: [], max: [], rms: [], peak: [] }] },
      ],
    });

    expect(curve?.bucketSeconds).toBe(1);
    expect(chooseExcerptWindow(curve!, 0, 600, 60)).toBe(300);
    expect(chooseExcerptWindow(curve!, 0, 40, 60)).toBe(0);
    expect(chooseExcerptWindow({ values: new Float32Array(600), bucketSeconds: 1 }, 0, 600, 60)).toBeNull();
  });
});

describe('streamed audio sync', () => {
  it('aligns a target from its excerpt alone and leaves an unrelated recording in place', async () => {
    const rate = 1000;
    const master = noise(600, rate, 7);
    // The target recording starts 50 s into the master; its excerpt is its own seconds 150..330.
    signals.set('master', { samples: master, offsetSeconds: 0 });
    signals.set('target', { samples: master.slice(200 * rate, 380 * rate), offsetSeconds: 150 });
    signals.set('other', { samples: noise(180, rate, 99), offsetSeconds: 20 });

    const report = await audioSync.syncTimelineClipsViaAudio(
      [{ clip: clip('master', 600) }, { clip: clip('target', 400) }, { clip: clip('other', 400) }],
      { masterClipId: 'master', minConfidence: 'medium' },
    );

    const target = report.alignments.find((alignment) => alignment.clipId === 'target');
    expect(target?.targetStartTime).toBeCloseTo(50, 2);
    expect(report.alignments.some((alignment) => alignment.clipId === 'other')).toBe(false);
    expect(report.failures.map((failure) => failure.clipId)).toEqual(['other']);
  }, 30_000);
});
