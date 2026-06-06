import { describe, expect, it, vi } from 'vitest';
import {
  collectTimelineAudioAnalysisArtifactRefs,
  warmTimelineAudioAnalysisArtifacts,
  type TimelineAudioAnalysisArtifact,
  type TimelineAudioAnalysisArtifactKind,
} from '../../src/services/timeline/timelineAudioAnalysisArtifactWarmup';

const artifact = {
  sampleRate: 48000,
  duration: 1,
  curves: [],
} as TimelineAudioAnalysisArtifact;

describe('timeline audio analysis artifact warmup', () => {
  it('collects unique effective non-waveform analysis refs from visible clips', () => {
    const refs = collectTimelineAudioAnalysisArtifactRefs([
      {
        audioState: {
          sourceAnalysisRefs: {
            loudnessEnvelopeId: 'source-loudness',
            beatGridId: 'source-beats',
            onsetMapId: 'source-onsets',
            frequencySummaryId: 'source-frequency',
            phaseCorrelationId: 'source-phase',
          },
        },
      },
      {
        audioState: {
          processedAnalysisRefs: {
            loudnessEnvelopeId: 'processed-loudness',
            beatGridId: 'processed-beats',
            frequencySummaryId: 'processed-frequency',
          },
          sourceAnalysisRefs: {
            loudnessEnvelopeId: 'source-loudness',
            beatGridId: 'source-beats',
            onsetMapId: 'source-onsets',
            frequencySummaryId: 'source-frequency',
            phaseCorrelationId: 'source-phase',
          },
        },
      },
    ]);

    expect(refs).toEqual([
      { kind: 'beat-grid', refId: 'processed-beats' },
      { kind: 'beat-grid', refId: 'source-beats' },
      { kind: 'frequency-summary', refId: 'processed-frequency' },
      { kind: 'frequency-summary', refId: 'source-frequency' },
      { kind: 'loudness-envelope', refId: 'processed-loudness' },
      { kind: 'loudness-envelope', refId: 'source-loudness' },
      { kind: 'onset-map', refId: 'source-onsets' },
      { kind: 'phase-correlation', refId: 'source-phase' },
    ]);
  });

  it('returns cached artifacts without loading from persistent storage', async () => {
    const getCachedArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => TimelineAudioAnalysisArtifact | null>().mockReturnValue(artifact);
    const loadArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => Promise<TimelineAudioAnalysisArtifact | null>>();
    const deps = { getCachedArtifact, loadArtifact };
    const ref = { kind: 'loudness-envelope' as const, refId: 'loudness-ref' };

    const results = await warmTimelineAudioAnalysisArtifacts([ref], { deps });

    expect(results).toEqual([{ ...ref, artifact, status: 'ready' }]);
    expect(loadArtifact).not.toHaveBeenCalled();
  });

  it('coalesces overlapping loads by artifact kind and ref id', async () => {
    let resolveBeatLoad: ((value: TimelineAudioAnalysisArtifact) => void) | undefined;
    let resolveOnsetLoad: ((value: TimelineAudioAnalysisArtifact) => void) | undefined;
    const beatLoadPromise = new Promise<TimelineAudioAnalysisArtifact>((resolve) => {
      resolveBeatLoad = resolve;
    });
    const onsetLoadPromise = new Promise<TimelineAudioAnalysisArtifact>((resolve) => {
      resolveOnsetLoad = resolve;
    });
    const getCachedArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => TimelineAudioAnalysisArtifact | null>().mockReturnValue(null);
    const loadArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => Promise<TimelineAudioAnalysisArtifact | null>>()
      .mockImplementation((kind) => (
        kind === 'beat-grid' ? beatLoadPromise : onsetLoadPromise
      ));
    const beatRef = { kind: 'beat-grid' as const, refId: 'shared-ref' };
    const onsetRef = { kind: 'onset-map' as const, refId: 'shared-ref' };

    const first = warmTimelineAudioAnalysisArtifacts([beatRef], {
      deps: { getCachedArtifact, loadArtifact },
    });
    const second = warmTimelineAudioAnalysisArtifacts([beatRef], {
      deps: { getCachedArtifact, loadArtifact },
    });
    const third = warmTimelineAudioAnalysisArtifacts([onsetRef], {
      deps: { getCachedArtifact, loadArtifact },
    });

    expect(loadArtifact).toHaveBeenCalledTimes(2);
    resolveBeatLoad?.(artifact);
    resolveOnsetLoad?.(artifact);

    await expect(first).resolves.toEqual([{ ...beatRef, artifact, status: 'ready' }]);
    await expect(second).resolves.toEqual([{ ...beatRef, artifact, status: 'ready' }]);
    await expect(third).resolves.toEqual([{ ...onsetRef, artifact, status: 'ready' }]);
  });

  it('publishes missing artifacts without retrying duplicate refs in one request', async () => {
    const getCachedArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => TimelineAudioAnalysisArtifact | null>().mockReturnValue(null);
    const loadArtifact = vi.fn<(
      kind: TimelineAudioAnalysisArtifactKind,
      refId: string | undefined,
    ) => Promise<TimelineAudioAnalysisArtifact | null>>().mockResolvedValue(null);
    const onResult = vi.fn();
    const ref = { kind: 'frequency-summary' as const, refId: 'missing-frequency' };

    const results = await warmTimelineAudioAnalysisArtifacts([ref, ref], {
      deps: { getCachedArtifact, loadArtifact },
      onResult,
    });

    expect(results).toEqual([{ ...ref, artifact: null, status: 'missing' }]);
    expect(loadArtifact).toHaveBeenCalledTimes(1);
    expect(onResult).toHaveBeenCalledWith({ ...ref, artifact: null, status: 'missing' });
  });
});
