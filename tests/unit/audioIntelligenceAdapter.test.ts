import { describe, expect, it, vi } from 'vitest';
import { ArtifactStore, MemoryArtifactStorageAdapter } from '../../src/artifacts';
import { adaptAudioIntelligenceArtifacts } from '../../src/services/agentTimeline/adapters/audioIntelligenceLegacyAdapter';
import {
  loadAudioIntelligencePayloads,
  type AudioIntelligenceArtifactSource,
  type AudioIntelligencePayloads,
} from '../../src/services/agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { getAgentTimelineRange } from '../../src/services/agentTimeline/query/agentTimelineRangeQuery';
import {
  materializeLegacyAgentTimelineReadSource,
  type LegacyReadSourceMaterializerInput,
} from '../../src/services/agentTimeline/runtime/legacyReadSource/materializeLegacyReadSource';
import { AudioArtifactStore } from '../../src/services/audio/AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioAnalysisArtifactKind, AudioArtifactRef } from '../../src/services/audio/audioArtifactTypes';
import {
  createOnsetMapManifest, encodeAudioEventListPayload, eventsToFloat32,
  type AudioEvent, type OnsetMapManifest,
} from '../../src/services/audio/beatOnsetManifest';
import {
  createLoudnessEnvelopeManifest, encodeLoudnessCurvePayload,
  type LoudnessEnvelopeManifest, type LoudnessEnvelopeMetric,
} from '../../src/services/audio/loudnessEnvelopeManifest';
import {
  countSpeechMarkers, createSpeechMarkersManifest, encodeSpeechMarkersPayload,
  type SpeechMarker, type SpeechMarkersManifest,
} from '../../src/services/audio/speechMarkersManifest';
import {
  createVoiceActivityManifest, encodeAudioSpanListPayload, spansToFloat32,
  type AudioSpan, type VoiceActivityManifest,
} from '../../src/services/audio/voiceActivityManifest';
import type { AgentTimelineEvent } from '../../src/types/agentTimeline/manifest';
import { SOURCE_IDENTITY_SCHEMA_VERSION, type SourceIdentity } from '../../src/types/agentTimeline/sourceIdentity';

const FIXED_TIME = '2026-07-28T10:00:00.000Z';
const DURATION = 8;
const CHANNEL_LAYOUT = { kind: 'mono', channelCount: 1, labels: ['Mix'] } as const;
let fixtureSequence = 0;

function createStore(): AudioArtifactStore {
  return new AudioArtifactStore(new ArtifactStore(new MemoryArtifactStorageAdapter(), () => FIXED_TIME));
}

async function putPayload(
  store: AudioArtifactStore,
  kind: AudioAnalysisArtifactKind,
  bytes: ArrayBuffer,
): Promise<AudioArtifactRef> {
  return store.putPayload(bytes, {
    mediaFileId: 'media-a', kind, sourceFingerprint: `fixture-${++fixtureSequence}`,
    mimeType: 'application/octet-stream', encoding: 'raw', analyzerVersion: 'fixture-analyzer@1',
  });
}

function fakeRef(name: string): AudioArtifactRef {
  return {
    artifactId: name, hash: `hash-${name}`, size: 1, mimeType: 'application/octet-stream',
    encoding: 'raw', storage: 'indexeddb', createdAt: FIXED_TIME,
  };
}

function artifact(
  kind: AudioAnalysisArtifactKind,
  manifestKey: string,
  manifest: object,
  overrides: Partial<AudioAnalysisArtifact> = {},
): AudioAnalysisArtifact {
  const sequence = ++fixtureSequence;
  return {
    schemaVersion: 1, id: `${kind}-${sequence}`, kind, mediaFileId: 'media-a',
    sourceFingerprint: 'source-a', decoderId: 'web-audio', decoderVersion: '1.2.0',
    analyzerVersion: `${kind}@1.0.0`, sampleRate: 48_000, channelLayout: CHANNEL_LAYOUT,
    duration: DURATION, payloadRefs: [],
    manifestRef: {
      ...fakeRef(`${kind}-manifest-${sequence}`), mimeType: 'application/json', encoding: 'json',
    },
    createdAt: sequence, stale: false,
    metadata: { [manifestKey]: manifest } as AudioAnalysisArtifact['metadata'],
    ...overrides,
  };
}

function voiceManifest(
  segmentsPayloadRef: AudioArtifactRef,
  segments: readonly AudioSpan[],
): VoiceActivityManifest {
  const speechSeconds = segments.reduce((total, span) => total + span.end - span.start, 0);
  return createVoiceActivityManifest({
    mediaFileId: 'media-a', sourceFingerprint: 'source-a', sampleRate: 48_000,
    analysisSampleRate: 16_000, channelLayout: CHANNEL_LAYOUT, duration: DURATION,
    model: { id: 'silero-vad', version: '5.1.2' },
    config: {
      threshold: 0.5, negThreshold: 0.35, minSpeechMs: 250, minSilenceMs: 100,
      padMs: 30, frameSamples: 512,
    },
    segmentCount: segments.length, segmentsPayloadRef,
    summary: { speechSeconds, speechRatio: speechSeconds / DURATION, segmentCount: segments.length },
  });
}

function onsetManifest(eventsPayloadRef: AudioArtifactRef, events: readonly AudioEvent[]): OnsetMapManifest {
  return createOnsetMapManifest({
    mediaFileId: 'media-a', sourceFingerprint: 'source-a', sampleRate: 48_000,
    channelLayout: CHANNEL_LAYOUT, duration: DURATION, fftSize: 2048, hopSize: 512,
    detectionFunction: 'spectral-flux', eventCount: events.length, eventsPayloadRef,
    summary: {
      eventCount: events.length,
      averageStrength: events.reduce((sum, event) => sum + event.strength, 0) / Math.max(1, events.length),
      peakStrength: Math.max(0, ...events.map(event => event.strength)),
    },
  });
}

function speechManifest(payloadRef: AudioArtifactRef, markers: readonly SpeechMarker[]): SpeechMarkersManifest {
  return createSpeechMarkersManifest({
    mediaFileId: 'media-a', sourceFingerprint: 'source-a', sampleRate: 48_000,
    channelLayout: CHANNEL_LAYOUT, duration: DURATION, markerCount: markers.length,
    counts: countSpeechMarkers(markers), payloadRef,
  });
}

function loudnessManifest(
  curves: Array<{ metric: LoudnessEnvelopeMetric; ref: AudioArtifactRef; pointCount: number }>,
): LoudnessEnvelopeManifest {
  return createLoudnessEnvelopeManifest({
    mediaFileId: 'media-a', sourceFingerprint: 'source-a', sampleRate: 48_000,
    channelLayout: CHANNEL_LAYOUT, duration: DURATION,
    curves: curves.map(curve => ({
      metric: curve.metric, windowDuration: 2, hopDuration: 2,
      pointCount: curve.pointCount, payloadRef: curve.ref,
    })),
  });
}

function source(kind: AudioAnalysisArtifactKind, artifactRef: string): AudioIntelligenceArtifactSource {
  return {
    kind, artifactRef, analyzerId: `fixture:${kind}`, analyzerVersion: '1.0.0',
    modelId: 'fixture-model', modelVersion: '2',
  };
}

function decodedPayloads(overrides: Partial<AudioIntelligencePayloads> = {}): AudioIntelligencePayloads {
  const loudnessRef = fakeRef('decoded-loudness');
  const peakRef = fakeRef('decoded-peak');
  const voiceRef = fakeRef('decoded-voice');
  const onsetRef = fakeRef('decoded-onset');
  const markerRef = fakeRef('decoded-markers');
  const voiceSegments: AudioSpan[] = [
    { start: 0, end: 2, confidence: 1.4 },
    { start: 3.2, end: 5, confidence: 0.85 },
    { start: 7, end: 8, confidence: -0.2 },
  ];
  const onsets: AudioEvent[] = [
    { time: 1, strength: 0.4, confidence: 0.8 },
    { time: 3.4, strength: 0.9, confidence: 1.5 },
    { time: 5.99, strength: 0.7, confidence: 0.75 },
  ];
  const markers: SpeechMarker[] = [{
    id: 'marker-a', type: 'breath', start: 2.2, end: 2.4, confidence: 1.2,
    text: 'inhale', wordIds: ['word-a'],
  }];
  return {
    loudness: {
      manifest: loudnessManifest([
        { metric: 'rms-dbfs', ref: loudnessRef, pointCount: 4 },
        { metric: 'sample-peak-dbfs', ref: peakRef, pointCount: 4 },
      ]),
      curves: [
        {
          metric: 'rms-dbfs',
          windows: [
            { start: 0, end: 2, valueDb: -24 }, { start: 2, end: 4, valueDb: -52 },
            { start: 4, end: 6, valueDb: -18 }, { start: 6, end: 8, valueDb: -30 },
          ],
        },
        {
          metric: 'sample-peak-dbfs',
          windows: [
            { start: 0, end: 2, valueDb: -4 }, { start: 2, end: 4, valueDb: -0.05 },
            { start: 4, end: 6, valueDb: -2 }, { start: 6, end: 8, valueDb: -5 },
          ],
        },
      ],
      source: source('loudness-envelope', 'loudness-artifact'),
    },
    onsets: { manifest: onsetManifest(onsetRef, onsets), events: onsets, source: source('onset-map', 'onset-artifact') },
    voiceActivity: {
      manifest: voiceManifest(voiceRef, voiceSegments), segments: voiceSegments,
      source: source('voice-activity', 'voice-artifact'),
    },
    speechMarkers: {
      manifest: speechManifest(markerRef, markers), markers,
      source: source('speech-markers', 'marker-artifact'),
    },
    ...overrides,
  };
}

function request(start = 0, end = DURATION) {
  return {
    queryRange: { start, end }, profile: 'balanced' as const,
    artifactRef: 'legacy/audio-intelligence',
  };
}

function interval(event: AgentTimelineEvent): { start: number; end: number } {
  if (event.time.temporalKind !== 'interval') throw new Error('Expected interval event');
  return { start: event.time.start, end: event.time.end };
}

function identity(): SourceIdentity {
  return {
    type: 'source-identity', version: SOURCE_IDENTITY_SCHEMA_VERSION, strategy: 'sampled-chunks',
    hashAlgorithm: 'sha-256', hash: 'ab'.repeat(32),
    metadata: { size: 1234, mediaType: 'video/mp4' },
  };
}

function materializerInput(
  overrides: Partial<LegacyReadSourceMaterializerInput> = {},
): LegacyReadSourceMaterializerInput {
  return {
    sourceIdentity: identity(), mediaFileId: 'media-a', durationSeconds: DURATION,
    generatedAt: FIXED_TIME, profile: 'balanced', ...overrides,
  };
}

describe('audio intelligence payload loader', () => {
  it('selects the newest fresh source artifact and ignores older, stale, and rendered artifacts', async () => {
    const store = createStore();
    const segments: AudioSpan[] = [{ start: 1, end: 2, confidence: 0.9 }];
    const ref = await putPayload(store, 'voice-activity', encodeAudioSpanListPayload({
      header: {
        schemaVersion: 1, kind: 'voice-activity-segments', spanCount: segments.length,
        valueLayout: 'span-major', valueEncoding: 'start-end-confidence-f32', timeUnit: 'seconds',
      },
      values: spansToFloat32(segments),
    }));
    const manifest = voiceManifest(ref, segments);
    const older = artifact('voice-activity', 'voiceActivityManifest', manifest, { createdAt: 10 });
    const newest = artifact('voice-activity', 'voiceActivityManifest', manifest, { createdAt: 30 });
    const stale = artifact('voice-activity', 'voiceActivityManifest', manifest, { createdAt: 40, stale: true });
    const rendered = artifact('voice-activity', 'voiceActivityManifest', manifest, {
      createdAt: 50, clipAudioStateHash: 'render-state',
    });

    const result = await loadAudioIntelligencePayloads([older, stale, rendered, newest], store);

    expect(result.voiceActivity?.source.artifactRef).toBe(newest.manifestRef.artifactId);
    expect(result.voiceActivity?.segments[0]).toMatchObject({ start: 1, end: 2 });
  });

  it('decodes loudness curves, onsets, voice spans, and speech markers', async () => {
    const store = createStore();
    const rmsValues = new Float32Array([-21.25, -18.5, -32.75, -24.125]);
    const rmsRef = await putPayload(store, 'loudness-envelope', encodeLoudnessCurvePayload({
      header: {
        schemaVersion: 1, metric: 'rms-dbfs', windowDuration: 2, hopDuration: 2,
        pointCount: rmsValues.length, valueLayout: 'time-series', valueEncoding: 'db',
      },
      values: rmsValues,
    }));
    const onsetEvents: AudioEvent[] = [{ time: 1.25, strength: 0.8, confidence: 0.7 }];
    const onsetRef = await putPayload(store, 'onset-map', encodeAudioEventListPayload({
      header: {
        schemaVersion: 1, kind: 'onset-map', eventCount: onsetEvents.length,
        valueLayout: 'event-major', valueEncoding: 'time-strength-confidence-f32', timeUnit: 'seconds',
      },
      values: eventsToFloat32(onsetEvents),
    }));
    const spans: AudioSpan[] = [{ start: 0.5, end: 2.75, confidence: 0.91 }];
    const voiceRef = await putPayload(store, 'voice-activity', encodeAudioSpanListPayload({
      header: {
        schemaVersion: 1, kind: 'voice-activity-segments', spanCount: spans.length,
        valueLayout: 'span-major', valueEncoding: 'start-end-confidence-f32', timeUnit: 'seconds',
      },
      values: spansToFloat32(spans),
    }));
    const markers: SpeechMarker[] = [{
      id: 'filler-a', type: 'filler', start: 1, end: 1.2, confidence: 0.88, text: 'um',
    }];
    const markerRef = await putPayload(store, 'speech-markers', encodeSpeechMarkersPayload({
      schemaVersion: 1, markers,
    }));
    const artifacts = [
      artifact('loudness-envelope', 'loudnessEnvelopeManifest', loudnessManifest([
        { metric: 'rms-dbfs', ref: rmsRef, pointCount: rmsValues.length },
      ])),
      artifact('onset-map', 'onsetMapManifest', onsetManifest(onsetRef, onsetEvents)),
      artifact('voice-activity', 'voiceActivityManifest', voiceManifest(voiceRef, spans)),
      artifact('speech-markers', 'speechMarkersManifest', speechManifest(markerRef, markers)),
    ];

    const result = await loadAudioIntelligencePayloads(artifacts, store);

    expect(result.loudness?.curves[0].windows).toEqual([
      { start: 0, end: 2, valueDb: -21.25 }, { start: 2, end: 4, valueDb: -18.5 },
      { start: 4, end: 6, valueDb: -32.75 }, { start: 6, end: 8, valueDb: -24.125 },
    ]);
    expect(result.onsets?.events[0].time).toBeCloseTo(1.25, 5);
    expect(result.onsets?.events[0].strength).toBeCloseTo(0.8, 5);
    expect(result.voiceActivity?.segments[0]).toMatchObject({ start: 0.5, end: 2.75 });
    expect(result.speechMarkers?.markers).toEqual(markers);
  });

  it('omits malformed or missing payload fields without rejecting the load', async () => {
    const store = createStore();
    const malformedRef = await putPayload(store, 'loudness-envelope', new Uint8Array([1, 2, 3, 4, 5]).buffer);
    const missingRef = fakeRef('payload-that-does-not-exist');
    const artifacts = [
      artifact('loudness-envelope', 'loudnessEnvelopeManifest', loudnessManifest([
        { metric: 'rms-dbfs', ref: malformedRef, pointCount: 1 },
      ])),
      artifact('onset-map', 'onsetMapManifest', onsetManifest(missingRef, [])),
      artifact('voice-activity', 'wrongManifestKey', {}),
      artifact('speech-markers', 'speechMarkersManifest', speechManifest(missingRef, [])),
    ];

    await expect(loadAudioIntelligencePayloads(artifacts, store)).resolves.toEqual({});
  });

  it('reuses decoded promises for identical refs through the loader LRU', async () => {
    const store = createStore();
    const values = new Float32Array([-33.375, -31.625]);
    const ref = await putPayload(store, 'loudness-envelope', encodeLoudnessCurvePayload({
      header: {
        schemaVersion: 1, metric: 'rms-dbfs', windowDuration: 1, hopDuration: 1,
        pointCount: values.length, valueLayout: 'time-series', valueEncoding: 'db',
      },
      values,
    }));
    const input = [artifact(
      'loudness-envelope',
      'loudnessEnvelopeManifest',
      createLoudnessEnvelopeManifest({
        mediaFileId: 'media-a', sourceFingerprint: 'source-lru', sampleRate: 48_000,
        channelLayout: CHANNEL_LAYOUT, duration: 2,
        curves: [{
          metric: 'rms-dbfs', windowDuration: 1, hopDuration: 1,
          pointCount: values.length, payloadRef: ref,
        }],
      }),
    )];
    const getPayload = vi.spyOn(store, 'getPayload');

    const first = await loadAudioIntelligencePayloads(input, store);
    const second = await loadAudioIntelligencePayloads(input, store);

    expect(second).toEqual(first);
    expect(getPayload).toHaveBeenCalledTimes(1);
    expect(getPayload).toHaveBeenCalledWith(ref.artifactId);
  });
});

describe('audio intelligence legacy adapter', () => {
  it('maps loudness windows to clipped audio measurements carrying loudnessDb', () => {
    const views = adaptAudioIntelligenceArtifacts(decodedPayloads(), request(2.5, 5));
    const measurements = views.audioView!.events.filter(event =>
      event.type === 'audio-activity'
      && event.data.activity === 'unknown'
      && event.data.loudnessDb !== undefined);

    expect(measurements.map(event => ({
      ...interval(event), loudnessDb: event.data.loudnessDb,
    }))).toEqual([
      { start: 2.5, end: 4, loudnessDb: -52 },
      { start: 4, end: 5, loudnessDb: -18 },
    ]);
  });

  it('turns VAD gaps into silence and onset points into clipped 50ms transients', () => {
    const views = adaptAudioIntelligenceArtifacts(decodedPayloads(), request(1, 6));
    const audio = views.audioView!.events.filter(event => event.type === 'audio-activity');
    const silences = audio.filter(event => event.data.activity === 'silence');
    const transients = audio.filter(event => event.data.activity === 'transient');

    expect(silences.map(interval)).toEqual([
      { start: 2, end: 3.2 }, { start: 5, end: 6 },
    ]);
    expect(transients.map(event => interval(event).start)).toEqual([1, 3.4, 5.99]);
    expect(interval(transients[0]).end).toBeCloseTo(1.05, 8);
    expect(interval(transients[1]).end).toBeCloseTo(3.45, 8);
    expect(interval(transients[2]).end).toBe(6);
  });

  it('appends classifier provenance to classification audio-activity spans', () => {
    const views = adaptAudioIntelligenceArtifacts(decodedPayloads(), request());
    const classified = views.audioView!.events.filter(event =>
      event.type === 'audio-activity'
      && event.provenance.some(item =>
        item.kind === 'analyzer' && item.analyzerId === 'persisted-audio-heuristic'));

    expect(classified.length).toBeGreaterThan(0);
    expect(classified.some(event => event.data.activity === 'speech')).toBe(true);
    expect(classified.every(event => event.provenance.some(item =>
      item.kind === 'analyzer' && item.analyzerId === 'audio-intelligence-legacy-adapter'))).toBe(true);
    expect(classified.every(event => event.provenance.some(item =>
      item.kind === 'analyzer' && item.artifactRef === 'loudness-artifact'))).toBe(true);
  });

  it('emits stable speech markers and only unoccupied interior pauses of at least one second', () => {
    const payloads = decodedPayloads();
    const first = adaptAudioIntelligenceArtifacts(payloads, request()).speechMarkerView!.events;
    const second = adaptAudioIntelligenceArtifacts(payloads, request()).speechMarkerView!.events;
    const markers = first.filter(event => event.type === 'speech-marker');

    expect(first.map(event => event.id)).toEqual(second.map(event => event.id));
    expect(markers.map(event => ({ marker: event.data.marker, ...interval(event) }))).toEqual([
      { marker: 'breath', start: 2.2, end: 2.4 },
      { marker: 'pause', start: 5, end: 7 },
    ]);
    expect(markers[0].data).toMatchObject({ text: 'inhale', wordId: 'word-a' });
  });

  it('keeps every event in clipped source time with bounded confidence and artifact plus adapter provenance', () => {
    const views = adaptAudioIntelligenceArtifacts(decodedPayloads(), request(2.25, 5.5));
    const events = [...views.audioView!.events, ...views.speechMarkerView!.events];

    expect(events.length).toBeGreaterThan(0);
    for (const event of events) {
      expect(event.time.timeDomain).toBe('source');
      expect(event.time).not.toHaveProperty('stateHash');
      expect(event.confidence).toBeGreaterThanOrEqual(0);
      expect(event.confidence).toBeLessThanOrEqual(1);
      expect(interval(event).start).toBeGreaterThanOrEqual(2.25);
      expect(interval(event).end).toBeLessThanOrEqual(5.5);
      expect(event.provenance.some(item =>
        item.kind === 'analyzer' && item.analyzerId === 'audio-intelligence-legacy-adapter')).toBe(true);
      expect(event.provenance.some(item =>
        item.kind === 'analyzer' && item.artifactRef?.endsWith('-artifact'))).toBe(true);
    }
  });

  it('returns no views for an empty payload object', () => {
    expect(adaptAudioIntelligenceArtifacts({}, request())).toEqual({});
  });
});

describe('audio intelligence legacy materialization', () => {
  it('routes audio activity, quality issues, and speech markers into their channel views', async () => {
    const sourceRead = materializeLegacyAgentTimelineReadSource(materializerInput({
      audioIntelligence: {
        value: decodedPayloads(), artifactRef: 'persisted/audio-intelligence',
        coverage: [{ start: 0, end: DURATION }],
      },
    }));

    expect(sourceRead.manifest.channels.audio.artifacts.length).toBeGreaterThan(0);
    expect(sourceRead.manifest.channels.quality.artifacts.length).toBeGreaterThan(0);
    expect(sourceRead.manifest.channels.speech.artifacts.length).toBeGreaterThan(0);
    const page = await getAgentTimelineRange({
      manifest: sourceRead.manifest, shardIndex: sourceRead.shardIndex,
      shardReader: sourceRead.shardReader,
      query: {
        scope: { mediaFileId: 'media-a' }, start: 0, end: DURATION,
        timeDomain: 'source', granularity: 'event',
        channels: ['audio', 'quality', 'speech'], includeFrames: false,
      },
    });
    expect(page.events.some(event => event.type === 'audio-activity')).toBe(true);
    expect(page.events.some(event => event.type === 'quality-issue')).toBe(true);
    expect(page.events.some(event => event.type === 'speech-marker')).toBe(true);
  });

  it('leaves materialized output unchanged from baseline when payloads are empty', () => {
    const baseline = materializeLegacyAgentTimelineReadSource(materializerInput());
    const empty = materializeLegacyAgentTimelineReadSource(materializerInput({
      audioIntelligence: {
        value: {}, artifactRef: 'persisted/empty-audio-intelligence',
        coverage: [{ start: 0, end: DURATION }],
      },
    }));

    expect(empty.manifest).toEqual(baseline.manifest);
    expect(empty.shardIndex).toEqual(baseline.shardIndex);
    expect(empty.mappingSourceId).toBe(baseline.mappingSourceId);
  });
});
