import { describe, expect, it } from 'vitest';
import { selectOcrFrameCandidates } from '../../src/services/agentTimeline/ocr/ocrCandidateSelection';
import { createOcrCacheKey } from '../../src/services/agentTimeline/ocr/ocrCacheKey';
import { decideOcrExecution } from '../../src/services/agentTimeline/ocr/ocrDecisionGate';
import { runLocalOcrPipeline } from '../../src/services/agentTimeline/ocr/localOcrPipeline';
import { normalizeOcrRecognitions } from '../../src/services/agentTimeline/ocr/ocrNormalization';
import type { AgentTimelineBenchmarkMeasurement } from '../../src/types/agentTimeline/benchmarkGate';
import type { OcrPipelineRequest } from '../../src/types/agentTimeline/ocr';
import type { LocalOcrWorker } from '../../src/services/agentTimeline/ocr/localOcrRuntimeContracts';

const benchmarkPolicy = {
  profile: 'balanced' as const,
  channel: 'text' as const,
  requiredPlatforms: ['windows'],
  requiredScenarios: ['ocr-titles'],
  maximumPeakMemoryBytes: 300_000_000,
  maximumArtifactBytesPerMediaMinute: 100_000,
};

const availability = {
  engineId: 'local-test', engineVersion: '1', state: 'ready' as const,
  languagePacks: [{ id: 'eng', language: 'eng', version: '1', bytes: 20, state: 'available-local' as const, source: 'local-bundled' as const }],
};

function measurement(cacheState: 'cold' | 'warm'): AgentTimelineBenchmarkMeasurement {
  return {
    id: `real-${cacheState}`, realMedia: true, profile: 'balanced', channels: ['text'],
    platform: 'windows', deviceClass: 'test', baselinePlatform: 'windows', baselineDeviceClass: 'test', scenarioId: 'ocr-titles', cacheState,
    baselineKind: 'standalone-cut', sourceDurationSeconds: 60, wallTimeSeconds: 5,
    baselineWallTimeSeconds: 4, peakMemoryBytes: 100_000_000, artifactBytes: 1_000,
    redundantDecodedSeconds: 0,
  };
}

function request(overrides: Partial<OcrPipelineRequest> = {}): OcrPipelineRequest {
  return {
    sourceIdentityHash: 'source', profile: 'balanced', analyzerId: 'ocr', analyzerVersion: 'v1',
    modelId: 'local-test', modelVersion: '1', languages: ['eng'],
    candidates: [{ shotId: 's1', sourceTime: 1, visibilityEnd: 2, reason: 'shot-keyframe' }],
    policy: { maximumRequiredDownloadBytes: 100, benchmarkPolicy },
    measurements: [measurement('cold'), measurement('warm')],
    ...overrides,
  };
}

describe('Agent Timeline optional local OCR', () => {
  it('uses one representative frame per shot plus bounded visual-change candidates only', () => {
    const candidates = selectOcrFrameCandidates([
      { shotId: 'a', start: 0, end: 10, keyframeSourceTime: 4 },
      { shotId: 'b', start: 10, end: 20 },
    ], [
      { sourceTime: 1, imageHash: 'a' }, { sourceTime: 4, imageHash: 'same-as-keyframe' },
      { sourceTime: 8, textRegionHash: 'changed' }, { sourceTime: 9 }, { sourceTime: 30, imageHash: 'outside' },
    ], { maxChangeCandidatesPerShot: 1 });
    expect(candidates).toEqual([
      { shotId: 'a', sourceTime: 1, visibilityEnd: 4, reason: 'visual-change', imageHash: 'a', textRegionHash: undefined },
      { shotId: 'a', sourceTime: 4, visibilityEnd: 10, reason: 'shot-keyframe' },
      { shotId: 'b', sourceTime: 15, visibilityEnd: 20, reason: 'shot-keyframe' },
    ]);
  });

  it('normalizes and deduplicates adjacent observations into half-open spans with provenance', () => {
    const provenance = [{ kind: 'analyzer' as const, analyzerId: 'ocr', analyzerVersion: 'v1' }];
    const events = normalizeOcrRecognitions([
      { candidate: { shotId: 's', sourceTime: 1, visibilityEnd: 2, reason: 'shot-keyframe' }, provenance, regions: [{ text: ' Hello  WORLD ', confidence: .8, language: 'eng', box: { x: .1, y: .82, width: .5, height: .1 } }] },
      { candidate: { shotId: 's', sourceTime: 2, visibilityEnd: 4, reason: 'visual-change' }, provenance, regions: [{ text: 'hello world', confidence: .6, language: 'eng', box: { x: .1, y: .82, width: .5, height: .1 } }] },
      { candidate: { shotId: 's', sourceTime: 5, visibilityEnd: 6, reason: 'visual-change' }, provenance, regions: [{ text: 'hello world', confidence: .9, language: 'eng', box: { x: .1, y: .82, width: .5, height: .1 } }] },
    ]);
    expect(events.map((event) => ({ time: event.time, text: event.type === 'onscreen-text' ? event.data.text : '', confidence: event.confidence }))).toEqual([
      { time: { temporalKind: 'interval', timeDomain: 'source', start: 1, end: 4 }, text: 'hello world', confidence: .7 },
      { time: { temporalKind: 'interval', timeDomain: 'source', start: 5, end: 6 }, text: 'hello world', confidence: .9 },
    ]);
    expect(events[0].provenance).toEqual(provenance);
    expect(events[0].type === 'onscreen-text' && events[0].data.kind).toBe('subtitle');
  });

  it('keeps Quick off and blocks Balanced without complete real benchmark evidence', () => {
    expect(decideOcrExecution({ profile: 'quick', languages: ['eng'], availability, policy: { maximumRequiredDownloadBytes: 100 } }).status).toBe('disabled');
    const blocked = decideOcrExecution({
      profile: 'balanced', languages: ['eng'], availability,
      policy: { maximumRequiredDownloadBytes: 100, benchmarkPolicy },
      measurements: [measurement('cold')],
    });
    expect(blocked).toMatchObject({ status: 'blocked', reasons: ['benchmark-gate-failed'] });
  });

  it('reports local download requirements and never treats them as cloud availability', () => {
    const decision = decideOcrExecution({
      profile: 'deep', languages: ['deu'],
      availability: { ...availability, languagePacks: [{ id: 'deu', language: 'deu', version: '1', bytes: 90, state: 'download-required', source: 'local-download' }] },
      policy: { maximumRequiredDownloadBytes: 100 },
    });
    expect(decision).toMatchObject({ status: 'requires-local-download', requiredDownloadBytes: 90 });
  });

  it('also requires matching real benchmark evidence before Deep OCR can run', () => {
    const decision = decideOcrExecution({
      profile: 'deep',
      languages: ['eng'],
      availability,
      policy: { maximumRequiredDownloadBytes: 100 },
    });
    expect(decision).toMatchObject({
      status: 'blocked',
      reasons: ['benchmark-evidence-required'],
    });
  });

  it('runs through injected local dependencies, releases frames, and persists no frame payload', async () => {
    let released = 0;
    const worker: LocalOcrWorker = {
      getAvailability: async () => availability,
      recognize: async () => [{ text: 'TITLE', confidence: .9, language: 'eng' }],
    };
    const result = await runLocalOcrPipeline({
      request: request(), worker,
      frames: { acquire: async () => ({ frame: new Blob(['pixels']), release: () => { released += 1; } }) },
    });
    expect(result.status).toBe('completed');
    expect(released).toBe(1);
    expect(JSON.stringify(result)).not.toContain('pixels');
    expect(result.events).toHaveLength(1);
  });

  it('cancels at candidate boundaries and includes analyzer/model versions in stable cache keys', async () => {
    const controller = new AbortController();
    const worker: LocalOcrWorker = {
      getAvailability: async () => availability,
      recognize: async ({ signal }) => {
        controller.abort();
        if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        return [];
      },
    };
    const localRequest = request({ candidates: [
      { shotId: 's', sourceTime: 1, visibilityEnd: 2, reason: 'shot-keyframe' },
      { shotId: 's', sourceTime: 2, visibilityEnd: 3, reason: 'visual-change' },
    ] });
    const result = await runLocalOcrPipeline({
      request: localRequest, worker, signal: controller.signal,
      frames: { acquire: async () => ({ frame: new Blob(), release: () => undefined }) },
    });
    expect(result.status).toBe('cancelled');
    expect(createOcrCacheKey(localRequest)).not.toBe(createOcrCacheKey({ ...localRequest, analyzerVersion: 'v2' }));
  });
});
