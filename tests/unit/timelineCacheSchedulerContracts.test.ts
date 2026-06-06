import { describe, expect, it } from 'vitest';
import {
  TIMELINE_CACHE_LANE_DESCRIPTORS,
  TIMELINE_CACHE_SCHEDULER_LANES,
  createArtifactRefCoalescingKey,
  createMediaCacheInvalidationPlan,
  createSourceCoalescingKey,
  createThumbnailDbLoadCoalescingKey,
  createThumbnailUrlCoalescingKey,
  formatTimelineCacheCoalescingKey,
  isTimelineCacheCoalescingScopeAllowed,
  normalizeTimelineAudioCacheRefs,
} from '../../src/services/timeline/cacheSchedulerContracts';
import type { TimelineCacheInvalidationPlan } from '../../src/services/timeline/cacheSchedulerTypes';

const EXPECTED_LANES = [
  'thumbnail-db-load',
  'thumbnail-generation',
  'thumbnail-bitmap-decode',
  'waveform-artifact-load',
  'source-waveform-generation',
  'processed-waveform-derivation',
  'spectrogram-tile-artifact-load',
  'spectrogram-tile-generation',
  'loudness-envelope-artifact-load',
  'loudness-envelope-generation',
  'beat-onset-artifact-load',
  'beat-onset-generation',
  'frequency-phase-artifact-load',
  'frequency-phase-generation',
] as const;

describe('timeline cache scheduler contracts', () => {
  it('keeps the lane list stable and covers cache warm responsibilities', () => {
    expect(TIMELINE_CACHE_SCHEDULER_LANES).toEqual(EXPECTED_LANES);
    expect(TIMELINE_CACHE_LANE_DESCRIPTORS).toHaveLength(EXPECTED_LANES.length);

    const descriptorByLane = new Map(
      TIMELINE_CACHE_LANE_DESCRIPTORS.map((descriptor) => [descriptor.lane, descriptor])
    );

    expect(descriptorByLane.get('thumbnail-db-load')?.coalescingScopes).toContain('media-source-id');
    expect(descriptorByLane.get('thumbnail-db-load')?.coalescingScopes).toContain('file-hash');
    expect(descriptorByLane.get('thumbnail-db-load')).toMatchObject({
      operation: 'load',
      priority: 'visible',
      mediaElementPolicy: 'forbidden',
    });
    expect(descriptorByLane.get('thumbnail-generation')?.mediaElementPolicy).toBe('detached-background-only');
    expect(descriptorByLane.get('thumbnail-bitmap-decode')?.coalescingScopes).toEqual(['thumbnail-url']);
    expect(descriptorByLane.get('waveform-artifact-load')?.coalescingScopes).toEqual(['audio-artifact-ref-id']);
    expect(descriptorByLane.get('source-waveform-generation')?.coalescingScopes).toContain('media-source-id');
    expect(descriptorByLane.get('processed-waveform-derivation')?.coalescingScopes).toContain('clip-audio-state-hash');
    expect(descriptorByLane.get('spectrogram-tile-artifact-load')?.coalescingScopes).toContain('audio-ref-group');
    expect(descriptorByLane.get('beat-onset-artifact-load')?.coalescingScopes).toContain('audio-ref-group');
    expect(descriptorByLane.get('frequency-phase-artifact-load')?.coalescingScopes).toContain('audio-ref-group');
  });

  it('formats in-flight coalescing keys by source, ref id, and thumbnail url', () => {
    const sourceKey = createSourceCoalescingKey('thumbnail-db-load', 'media-1', 'hash-a');
    const artifactKey = createArtifactRefCoalescingKey('waveform-artifact-load', 'waveform-ref-1');
    const bitmapKey = createThumbnailUrlCoalescingKey('blob:http://local/thumb 1');

    expect(formatTimelineCacheCoalescingKey(sourceKey)).toBe('thumbnail-db-load:media-source-id:media-1:hash-a');
    expect(formatTimelineCacheCoalescingKey(artifactKey)).toBe('waveform-artifact-load:audio-artifact-ref-id:waveform-ref-1');
    expect(formatTimelineCacheCoalescingKey(bitmapKey)).toBe('thumbnail-bitmap-decode:thumbnail-url:blob%3Ahttp%3A%2F%2Flocal%2Fthumb%201');
    expect(isTimelineCacheCoalescingScopeAllowed('thumbnail-bitmap-decode', 'thumbnail-url')).toBe(true);
    expect(isTimelineCacheCoalescingScopeAllowed('thumbnail-bitmap-decode', 'media-source-id')).toBe(false);
  });

  it('formats thumbnail DB load keys through the dedicated helper', () => {
    expect(formatTimelineCacheCoalescingKey(
      createThumbnailDbLoadCoalescingKey('media-1', 'hash-a'),
    )).toBe('thumbnail-db-load:media-source-id:media-1:hash-a');
  });

  it('normalizes audio refs from source, processed, and explicit contract inputs', () => {
    expect(normalizeTimelineAudioCacheRefs({
      sourceAudioAnalysisRefs: {
        waveformPyramidId: 'waveform-source',
        spectrogramTileSetIds: ['spectro-a', 'spectro-b'],
        beatGridId: 'beat-a',
        onsetMapId: 'onset-a',
      },
      processedAudioAnalysisRefs: {
        processedWaveformPyramidId: 'waveform-processed',
        loudnessEnvelopeId: 'loudness-a',
        phaseCorrelationId: 'phase-a',
        frequencySummaryId: 'frequency-a',
      },
      explicitAudioRefs: {
        waveformPyramidIds: ['waveform-source'],
        spectrogramTileSetIds: ['spectro-b', 'spectro-c'],
      },
    })).toEqual({
      waveformPyramidIds: ['waveform-source'],
      processedWaveformPyramidIds: ['waveform-processed'],
      spectrogramTileSetIds: ['spectro-a', 'spectro-b', 'spectro-c'],
      loudnessEnvelopeIds: ['loudness-a'],
      beatGridIds: ['beat-a'],
      onsetMapIds: ['onset-a'],
      phaseCorrelationIds: ['phase-a'],
      frequencySummaryIds: ['frequency-a'],
    });
  });

  it('builds the media deletion/source replacement invalidation plan shape', () => {
    const plan = createMediaCacheInvalidationPlan({
      reason: 'media-delete',
      mediaFileId: 'media-1',
      fileHash: 'sha256:shared',
      clipIds: ['clip-a', 'clip-b'],
      sourceAudioAnalysisRefs: {
        waveformPyramidId: 'waveform-source',
        spectrogramTileSetIds: ['spectro-source'],
        beatGridId: 'beat-source',
        onsetMapId: 'onset-source',
      },
      processedAudioAnalysisRefs: {
        processedWaveformPyramidId: 'waveform-processed',
        loudnessEnvelopeId: 'loudness-processed',
        frequencySummaryId: 'frequency-processed',
        phaseCorrelationId: 'phase-processed',
      },
      sharedArtifactRefIds: ['waveform-source', 'spectro-source'],
      preserveSharedFileHashArtifacts: true,
    });

    expect(plan).toMatchObject({
      reason: 'media-delete',
      mediaFileId: 'media-1',
    });
    expect(action(plan, 'thumbnailCacheService', 'abort-queued-work')).toMatchObject({
      lanes: ['thumbnail-generation'],
      persistence: 'memory-only',
      requiredApi: 'thumbnailCacheService.abort(mediaFileId)',
    });
    expect(action(plan, 'thumbnailCacheService', 'clear-source-thumbnails')).toMatchObject({
      lanes: ['thumbnail-db-load', 'thumbnail-generation'],
      persistence: 'memory-and-persistent',
      requiredApi: 'thumbnailCacheService.clearSource(mediaFileId)',
    });
    expect(action(plan, 'thumbnailBitmapCache', 'close-decoded-resources')).toMatchObject({
      lanes: ['thumbnail-bitmap-decode'],
      persistence: 'memory-only',
      requiredApi: 'thumbnailBitmapCache.closeSource(mediaFileId) or thumbnailCacheService.evictFromMemory(mediaFileId)',
      note: 'Decoded ImageBitmap resources must be closed before thumbnail blob URLs are revoked.',
    });
    expect(action(plan, 'timelineWaveformPyramidCache', 'evict-memory')?.target.refIds).toEqual([
      'waveform-source',
      'waveform-processed',
    ]);
    expect(action(plan, 'timelineSpectrogramCache', 'evict-memory')?.target.refIds).toEqual(['spectro-source']);
    expect(action(plan, 'timelineLoudnessEnvelopeCache', 'evict-memory')?.target.refIds).toEqual(['loudness-processed']);
    expect(action(plan, 'timelineBeatOnsetCache', 'evict-memory')?.target.refIds).toEqual(['beat-source', 'onset-source']);
    expect(action(plan, 'timelineFrequencyPhaseCache', 'evict-memory')?.target.refIds).toEqual([
      'frequency-processed',
      'phase-processed',
    ]);
    expect(action(plan, 'clipAudioAnalysisJobService', 'cancel-analysis-jobs')?.target.clipIds).toEqual([
      'clip-a',
      'clip-b',
    ]);
    expect(action(plan, 'audioArtifactStore', 'preserve-shared-artifacts')).toMatchObject({
      persistence: 'preserve-when-shared',
      target: {
        mediaFileId: 'media-1',
        fileHash: 'sha256:shared',
        refIds: ['waveform-source', 'spectro-source'],
      },
    });
  });

  it('keeps descriptors and invalidation plans as JSON-safe plain data', () => {
    const plan = createMediaCacheInvalidationPlan({
      reason: 'source-replace',
      mediaFileId: 'media-old',
      replacementMediaFileId: 'media-new',
      clipIds: ['clip-old'],
      sourceAudioAnalysisRefs: {
        waveformPyramidId: 'waveform-old',
      },
    });

    expect(JSON.parse(JSON.stringify(TIMELINE_CACHE_LANE_DESCRIPTORS))).toEqual(TIMELINE_CACHE_LANE_DESCRIPTORS);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
    expect(findNonPlainPath(TIMELINE_CACHE_LANE_DESCRIPTORS)).toBeNull();
    expect(findNonPlainPath(plan)).toBeNull();
  });
});

function action(
  plan: TimelineCacheInvalidationPlan,
  service: string,
  type: string,
) {
  return plan.actions.find((candidate) => candidate.service === service && candidate.type === type);
}

function findNonPlainPath(value: unknown, path = '$'): string | null {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return null;
  }

  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) {
    return path;
  }

  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findNonPlainPath(value[index], `${path}[${index}]`);
      if (found) return found;
    }
    return null;
  }

  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, child] of Object.entries(value)) {
      const found = findNonPlainPath(child, `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }

  return path;
}
