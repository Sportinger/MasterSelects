import { describe, expect, it, vi } from 'vitest';
import type { TimelineWaveformPyramid } from '../../src/components/timeline/utils/waveformLod';
import {
  type TimelineBeatGrid,
  type TimelineOnsetMap,
  evictTimelineBeatOnsetRefs,
  getCachedTimelineBeatGrid,
  getCachedTimelineOnsetMap,
  primeTimelineBeatGridCache,
  primeTimelineOnsetMapCache,
} from '../../src/services/audio/timelineBeatOnsetCache';
import {
  type TimelineFrequencySummary,
  type TimelinePhaseCorrelation,
  evictTimelineFrequencyPhaseRefs,
  getCachedTimelineFrequencySummary,
  getCachedTimelinePhaseCorrelation,
  primeTimelineFrequencySummaryCache,
  primeTimelinePhaseCorrelationCache,
} from '../../src/services/audio/timelineFrequencyPhaseCache';
import {
  type TimelineLoudnessEnvelope,
  evictTimelineLoudnessEnvelopeRefs,
  getCachedTimelineLoudnessEnvelope,
  primeTimelineLoudnessEnvelopeCache,
} from '../../src/services/audio/timelineLoudnessEnvelopeCache';
import {
  type TimelineSpectrogramTileSet,
  evictTimelineSpectrogramTileSetRefs,
  getCachedTimelineSpectrogramTileSet,
  primeTimelineSpectrogramTileSetCache,
} from '../../src/services/audio/timelineSpectrogramCache';
import {
  evictTimelineWaveformPyramidRefs,
  getCachedTimelineWaveformPyramid,
  primeTimelineWaveformPyramidCache,
} from '../../src/services/audio/timelineWaveformPyramidCache';
import { createMediaCacheInvalidationPlan } from '../../src/services/timeline/cacheSchedulerContracts';
import {
  collectTimelineAudioCacheRefsFromClips,
  executeTimelineCacheInvalidationPlan,
  type TimelineCacheInvalidationDeps,
} from '../../src/services/timeline/timelineCacheInvalidation';

const waveform: TimelineWaveformPyramid = {
  sampleRate: 48000,
  duration: 1,
  levels: [],
};

const spectrogram: TimelineSpectrogramTileSet = {
  sampleRate: 48000,
  duration: 1,
  fftSize: 1024,
  hopSize: 256,
  minDb: -80,
  maxDb: 0,
  frameCount: 0,
  frequencyBinCount: 0,
  channels: [],
};

const loudness: TimelineLoudnessEnvelope = {
  sampleRate: 48000,
  duration: 1,
  curves: [],
};

const beatGrid: TimelineBeatGrid = {
  sampleRate: 48000,
  duration: 1,
  beatCount: 0,
  beats: [],
  summary: {} as TimelineBeatGrid['summary'],
};

const onsetMap: TimelineOnsetMap = {
  sampleRate: 48000,
  duration: 1,
  fftSize: 1024,
  hopSize: 256,
  eventCount: 0,
  onsets: [],
  summary: {} as TimelineOnsetMap['summary'],
};

const frequency: TimelineFrequencySummary = {
  sampleRate: 48000,
  duration: 1,
  fftSize: 1024,
  hopSize: 256,
  bands: [],
  summary: {} as TimelineFrequencySummary['summary'],
};

const phase: TimelinePhaseCorrelation = {
  sampleRate: 48000,
  duration: 1,
  windowDuration: 0.1,
  hopDuration: 0.05,
  points: [],
  summary: {} as TimelinePhaseCorrelation['summary'],
};

function createDeps(): TimelineCacheInvalidationDeps {
  return {
    abortThumbnailGeneration: vi.fn(),
    clearSourceThumbnails: vi.fn(async () => undefined),
    evictSourceThumbnails: vi.fn(),
    closeThumbnailBitmaps: vi.fn(),
    evictWaveformRefs: vi.fn(() => 2),
    evictSpectrogramRefs: vi.fn(() => 1),
    evictLoudnessRefs: vi.fn(() => 1),
    evictBeatOnsetRefs: vi.fn(() => 2),
    evictFrequencyPhaseRefs: vi.fn(() => 2),
    cancelClipAnalysisJobs: vi.fn(() => 1),
  };
}

describe('timeline cache invalidation', () => {
  it('evicts timeline audio cache entries by artifact ref id', () => {
    primeTimelineWaveformPyramidCache(['waveform-ref'], waveform);
    primeTimelineSpectrogramTileSetCache(['spectrogram-ref'], spectrogram);
    primeTimelineLoudnessEnvelopeCache(['loudness-ref'], loudness);
    primeTimelineBeatGridCache(['beat-ref'], beatGrid);
    primeTimelineOnsetMapCache(['onset-ref'], onsetMap);
    primeTimelineFrequencySummaryCache(['frequency-ref'], frequency);
    primeTimelinePhaseCorrelationCache(['phase-ref'], phase);

    expect(evictTimelineWaveformPyramidRefs(['waveform-ref', 'missing'])).toBe(1);
    expect(evictTimelineSpectrogramTileSetRefs(['spectrogram-ref'])).toBe(1);
    expect(evictTimelineLoudnessEnvelopeRefs(['loudness-ref'])).toBe(1);
    expect(evictTimelineBeatOnsetRefs(['beat-ref', 'onset-ref'])).toBe(2);
    expect(evictTimelineFrequencyPhaseRefs(['frequency-ref', 'phase-ref'])).toBe(2);

    expect(getCachedTimelineWaveformPyramid('waveform-ref')).toBeNull();
    expect(getCachedTimelineSpectrogramTileSet('spectrogram-ref')).toBeNull();
    expect(getCachedTimelineLoudnessEnvelope('loudness-ref')).toBeNull();
    expect(getCachedTimelineBeatGrid('beat-ref')).toBeUndefined();
    expect(getCachedTimelineOnsetMap('onset-ref')).toBeUndefined();
    expect(getCachedTimelineFrequencySummary('frequency-ref')).toBeUndefined();
    expect(getCachedTimelinePhaseCorrelation('phase-ref')).toBeUndefined();
  });

  it('collects clip-owned source, processed, and legacy audio refs for media deletion', () => {
    const refs = collectTimelineAudioCacheRefsFromClips([
      {
        id: 'clip-a',
        audioState: {
          sourceAnalysisRefs: {
            waveformPyramidId: 'source-waveform',
            spectrogramTileSetIds: ['source-spectrogram'],
            beatGridId: 'source-beats',
            onsetMapId: 'source-onsets',
          },
          processedAnalysisRefs: {
            waveformPyramidId: 'legacy-processed-waveform',
            processedWaveformPyramidId: 'processed-waveform',
            loudnessEnvelopeId: 'processed-loudness',
            frequencySummaryId: 'processed-frequency',
            phaseCorrelationId: 'processed-phase',
          },
        },
      },
      {
        id: 'clip-b',
        audioState: {
          sourceAnalysisRefs: {
            waveformPyramidId: 'source-waveform',
            spectrogramTileSetIds: ['source-spectrogram', 'source-spectrogram-b'],
          },
        },
      },
    ]);

    expect(refs).toEqual({
      waveformPyramidIds: ['source-waveform', 'legacy-processed-waveform'],
      processedWaveformPyramidIds: ['processed-waveform'],
      spectrogramTileSetIds: ['source-spectrogram', 'source-spectrogram-b'],
      loudnessEnvelopeIds: ['processed-loudness'],
      beatGridIds: ['source-beats'],
      onsetMapIds: ['source-onsets'],
      phaseCorrelationIds: ['processed-phase'],
      frequencySummaryIds: ['processed-frequency'],
    });
  });

  it('executes a media invalidation plan against cache and job services', async () => {
    const deps = createDeps();
    const plan = createMediaCacheInvalidationPlan({
      reason: 'media-delete',
      mediaFileId: 'media-1',
      fileHash: 'hash-1',
      clipIds: ['clip-a', 'clip-b'],
      sourceAudioAnalysisRefs: {
        waveformPyramidId: 'source-waveform',
        spectrogramTileSetIds: ['source-spectrogram'],
      },
      processedAudioAnalysisRefs: {
        processedWaveformPyramidId: 'processed-waveform',
        loudnessEnvelopeId: 'processed-loudness',
        beatGridId: 'processed-beats',
        onsetMapId: 'processed-onsets',
        frequencySummaryId: 'processed-frequency',
        phaseCorrelationId: 'processed-phase',
      },
    });

    const result = await executeTimelineCacheInvalidationPlan(plan, deps);

    expect(deps.abortThumbnailGeneration).toHaveBeenCalledWith('media-1');
    expect(deps.clearSourceThumbnails).toHaveBeenCalledWith('media-1');
    expect(deps.closeThumbnailBitmaps).toHaveBeenCalledWith('media-1');
    expect(deps.evictWaveformRefs).toHaveBeenCalledWith(['source-waveform', 'processed-waveform']);
    expect(deps.evictSpectrogramRefs).toHaveBeenCalledWith(['source-spectrogram']);
    expect(deps.evictLoudnessRefs).toHaveBeenCalledWith(['processed-loudness']);
    expect(deps.evictBeatOnsetRefs).toHaveBeenCalledWith(['processed-beats', 'processed-onsets']);
    expect(deps.evictFrequencyPhaseRefs).toHaveBeenCalledWith(['processed-frequency', 'processed-phase']);
    expect(deps.cancelClipAnalysisJobs).toHaveBeenCalledWith('clip-a');
    expect(deps.cancelClipAnalysisJobs).toHaveBeenCalledWith('clip-b');
    expect(result.actions.find(action => action.service === 'clipAudioAnalysisJobService')?.affectedCount).toBe(2);
  });
});
