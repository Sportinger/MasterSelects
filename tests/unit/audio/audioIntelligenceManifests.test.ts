import { describe, expect, it } from 'vitest';
import {
  AUDIO_ANALYSIS_ARTIFACT_KINDS,
} from '../../../src/services/audio/audioArtifactTypes';
import {
  AUDIO_ANALYSIS_REF_KINDS,
  addAudioAnalysisManifestRef,
  createAudioAnalysisManifestRef,
  createAudioAnalysisRefsManifest,
  getAudioAnalysisRefFreshness,
} from '../../../src/services/audio/audioAnalysisManifestKeys';
import {
  decodeDenseCurvePayload,
  encodeDenseCurvePayload,
} from '../../../src/services/audio/denseCurvePayload';
import {
  createVoiceActivityManifest,
  decodeAudioSpanListPayload,
  encodeAudioSpanListPayload,
  float32ToSpans,
  spansToFloat32,
} from '../../../src/services/audio/voiceActivityManifest';
import {
  countSpeechMarkers,
  createSpeechMarkersManifest,
  decodeSpeechMarkersPayload,
  encodeSpeechMarkersPayload,
  type SpeechMarker,
} from '../../../src/services/audio/speechMarkersManifest';
import { createProsodyContourManifest } from '../../../src/services/audio/prosodyContourManifest';
import { createRoomToneProfileManifest } from '../../../src/services/audio/roomToneProfileManifest';
import {
  computeTranscriptWordsHash,
  createTranscriptTimingFingerprint,
  createTranscriptTimingManifest,
  decodeTranscriptTimingPayload,
  encodeTranscriptTimingPayload,
  payloadToTimings,
  timingsToPayload,
} from '../../../src/services/audio/transcriptTimingManifest';
import type { AudioArtifactRef, AudioChannelLayout } from '../../../src/services/audio/audioArtifactTypes';

const channelLayout: AudioChannelLayout = { kind: 'mono', channelCount: 1 };

const payloadRef: AudioArtifactRef = {
  artifactId: 'artifact-1',
  hash: 'hash-1',
  size: 128,
  mimeType: 'application/octet-stream',
  encoding: 'raw',
  storage: { kind: 'memory' },
  createdAt: '2026-07-28T00:00:00.000Z',
};

const NEW_KINDS = ['voice-activity', 'speech-markers', 'prosody-contour', 'room-tone-profile'] as const;

describe('audio intelligence artifact kinds', () => {
  it('registers the new kinds in the artifact kind list', () => {
    for (const kind of NEW_KINDS) {
      expect(AUDIO_ANALYSIS_ARTIFACT_KINDS).toContain(kind);
    }
  });

  it('registers the new kinds as ref kinds with working manifest slots', () => {
    for (const kind of NEW_KINDS) {
      expect(AUDIO_ANALYSIS_REF_KINDS).toContain(kind);

      const ref = createAudioAnalysisManifestRef({
        artifactId: `artifact-${kind}`,
        mediaFileId: 'media-1',
        sourceFingerprint: 'fp-1',
        kind,
        analyzerVersion: 'test@1.0.0',
        channelLayout,
        sampleRate: 48000,
        duration: 12.5,
      });
      const manifest = addAudioAnalysisManifestRef(createAudioAnalysisRefsManifest(), ref);
      const freshness = getAudioAnalysisRefFreshness(manifest, {
        mediaFileId: 'media-1',
        sourceFingerprint: 'fp-1',
        kind,
        analyzerVersion: 'test@1.0.0',
        channelLayout,
        sampleRate: 48000,
        duration: 12.5,
      });
      expect(freshness.stale).toBe(false);
      expect(freshness.artifactId).toBe(`artifact-${kind}`);
    }
  });
});

describe('dense curve payload', () => {
  it('round-trips header and values', () => {
    const encoded = encodeDenseCurvePayload({
      header: {
        schemaVersion: 1,
        metric: 'f0-hz',
        windowDuration: 0.04,
        hopDuration: 0.01,
        pointCount: 4,
        valueLayout: 'time-series',
        valueEncoding: 'hz',
      },
      values: new Float32Array([120, 0, 132.5, 128]),
    });
    const decoded = decodeDenseCurvePayload(encoded);
    expect(decoded.header.metric).toBe('f0-hz');
    expect(Array.from(decoded.values)).toEqual([120, 0, 132.5, 128]);
  });

  it('rejects mismatched point counts', () => {
    expect(() => encodeDenseCurvePayload({
      header: {
        schemaVersion: 1,
        metric: 'voicing',
        windowDuration: 0.04,
        hopDuration: 0.01,
        pointCount: 2,
        valueLayout: 'time-series',
        valueEncoding: 'unit',
      },
      values: new Float32Array([1]),
    })).toThrow();
  });
});

describe('voice activity manifest', () => {
  it('round-trips span payloads', () => {
    const spans = [
      { start: 0.5, end: 2.25, confidence: 0.91 },
      { start: 3, end: 4.5, confidence: 0.84 },
    ];
    const encoded = encodeAudioSpanListPayload({
      header: {
        schemaVersion: 1,
        kind: 'voice-activity-segments',
        spanCount: spans.length,
        valueLayout: 'span-major',
        valueEncoding: 'start-end-confidence-f32',
        timeUnit: 'seconds',
      },
      values: spansToFloat32(spans),
    });
    const decoded = decodeAudioSpanListPayload(encoded);
    const roundTripped = float32ToSpans(decoded.values);
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped[0].start).toBeCloseTo(0.5, 5);
    expect(roundTripped[1].confidence).toBeCloseTo(0.84, 5);
  });

  it('creates a validated manifest', () => {
    const manifest = createVoiceActivityManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1',
      sampleRate: 48000,
      analysisSampleRate: 16000,
      channelLayout,
      duration: 30,
      model: { id: 'silero-vad', version: 'v5' },
      config: {
        threshold: 0.5,
        negThreshold: 0.35,
        minSpeechMs: 250,
        minSilenceMs: 100,
        padMs: 30,
        frameSamples: 512,
      },
      segmentCount: 2,
      segmentsPayloadRef: payloadRef,
      summary: { speechSeconds: 3.25, speechRatio: 0.108, segmentCount: 2 },
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.model.id).toBe('silero-vad');
    expect(() => createVoiceActivityManifest({
      ...manifest,
      summary: { ...manifest.summary, speechRatio: 1.5 },
    })).toThrow();
  });
});

describe('speech markers manifest', () => {
  const markers: SpeechMarker[] = [
    {
      id: 'marker-1',
      type: 'breath',
      start: 1.2,
      end: 1.55,
      confidence: 0.72,
      evidence: { rmsDb: -38, spectralFlatness: 0.44 },
    },
    {
      id: 'marker-2',
      type: 'filler',
      start: 4.1,
      end: 4.4,
      confidence: 0.88,
      wordIds: ['word-9'],
      text: 'ähm',
      language: 'de',
    },
  ];

  it('round-trips the JSON payload with validation', () => {
    const encoded = encodeSpeechMarkersPayload({ schemaVersion: 1, markers });
    const decoded = decodeSpeechMarkersPayload(encoded);
    expect(decoded.markers).toHaveLength(2);
    expect(decoded.markers[1].text).toBe('ähm');
  });

  it('rejects invalid marker types and confidences', () => {
    expect(() => encodeSpeechMarkersPayload({
      schemaVersion: 1,
      markers: [{ ...markers[0], type: 'cough' as SpeechMarker['type'] }],
    })).toThrow();
    expect(() => encodeSpeechMarkersPayload({
      schemaVersion: 1,
      markers: [{ ...markers[0], confidence: 2 }],
    })).toThrow();
  });

  it('creates a manifest with counts', () => {
    const counts = countSpeechMarkers(markers);
    expect(counts.breath).toBe(1);
    expect(counts.filler).toBe(1);
    const manifest = createSpeechMarkersManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1',
      sampleRate: 48000,
      channelLayout,
      duration: 30,
      markerCount: markers.length,
      counts,
      payloadRef,
      transcriptHash: 'abc123',
    });
    expect(manifest.counts.breath).toBe(1);
  });
});

describe('prosody contour manifest', () => {
  it('validates and sorts curves', () => {
    const manifest = createProsodyContourManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1',
      sampleRate: 48000,
      analysisSampleRate: 16000,
      channelLayout,
      duration: 30,
      curves: [
        { metric: 'voicing', windowDuration: 0.04, hopDuration: 0.01, pointCount: 3000, payloadRef },
        { metric: 'f0-hz', windowDuration: 0.04, hopDuration: 0.01, pointCount: 3000, payloadRef },
      ],
      summary: { medianF0Hz: 118 },
    });
    expect(manifest.curves[0].metric).toBe('f0-hz');
    expect(() => createProsodyContourManifest({ ...manifest, curves: [] })).toThrow();
  });

  it('round-trips and validates per-word emphasis', () => {
    const manifest = createProsodyContourManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1+transcript=hash-1',
      sampleRate: 48000,
      analysisSampleRate: 16000,
      channelLayout,
      duration: 30,
      curves: [
        { metric: 'f0-hz', windowDuration: 0.04, hopDuration: 0.01, pointCount: 3000, payloadRef },
      ],
      wordEmphasis: [
        { wordId: 'word-1', emphasis: 0.85, f0MeanHz: 126 },
        { wordId: 'word-2', emphasis: 0.2 },
      ],
    });

    expect(manifest.wordEmphasis).toEqual([
      { wordId: 'word-1', emphasis: 0.85, f0MeanHz: 126 },
      { wordId: 'word-2', emphasis: 0.2 },
    ]);
    expect(() => createProsodyContourManifest({
      ...manifest,
      wordEmphasis: [{ wordId: '', emphasis: 0.5 }],
    })).toThrow('wordEmphasis.wordId must be a non-empty string.');
    expect(() => createProsodyContourManifest({
      ...manifest,
      wordEmphasis: [{ wordId: 'word-1', emphasis: 1.01 }],
    })).toThrow('wordEmphasis.emphasis must be within [0, 1].');
  });
});

describe('room tone profile manifest', () => {
  it('ranks candidates by score and validates band arrays', () => {
    const manifest = createRoomToneProfileManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1',
      sampleRate: 48000,
      channelLayout,
      duration: 30,
      candidates: [
        { start: 1, end: 1.6, rmsDb: -52, variance: 0.4, score: 0.6 },
        { start: 8, end: 9.2, rmsDb: -55, variance: 0.2, score: 0.9 },
      ],
      noiseFloor: { rmsDbMedian: -53, rmsDbP10: -57, rmsDbP90: -49 },
      bandLayout: 'third-octave',
      bandCentersHz: [100, 125, 160],
      bandAverageDb: [-60, -58, -57],
    });
    expect(manifest.candidates[0].score).toBe(0.9);
    expect(() => createRoomToneProfileManifest({
      ...manifest,
      bandAverageDb: [-60],
    })).toThrow();
  });
});

describe('transcript timing manifest', () => {
  const timings = [
    { wordId: 'word-1', alignedStart: 0.52, alignedEnd: 0.87, confidence: 0.9 },
    { wordId: 'word-2', alignedStart: 0.91, alignedEnd: 1.3, confidence: 0.75 },
  ];

  it('round-trips word timings', () => {
    const payload = timingsToPayload(timings, 'acoustic-refine');
    const decoded = decodeTranscriptTimingPayload(encodeTranscriptTimingPayload(payload));
    const roundTripped = payloadToTimings(decoded);
    expect(roundTripped).toHaveLength(2);
    expect(roundTripped[0].wordId).toBe('word-1');
    expect(roundTripped[1].alignedEnd).toBeCloseTo(1.3, 5);
    expect(decoded.header.method).toBe('acoustic-refine');
  });

  it('creates a manifest and rejects unsupported methods', () => {
    const manifest = createTranscriptTimingManifest({
      mediaFileId: 'media-1',
      sourceFingerprint: 'fp-1+transcript=abc',
      sampleRate: 48000,
      channelLayout,
      duration: 30,
      method: 'acoustic-refine',
      transcriptHash: 'abc',
      wordCount: 2,
      timingsPayloadRef: payloadRef,
    });
    expect(manifest.method).toBe('acoustic-refine');
    expect(() => createTranscriptTimingManifest({
      ...manifest,
      method: 'dtw' as typeof manifest.method,
    })).toThrow();
  });

  it('builds deterministic fingerprints and transcript hashes', async () => {
    expect(createTranscriptTimingFingerprint('audio-fp', 'hash-1'))
      .toBe('audio-fp+transcript=hash-1');
    expect(() => createTranscriptTimingFingerprint('', 'hash-1')).toThrow();

    const words = [
      { id: 'w1', text: 'hallo', start: 0.1234567, end: 0.5 },
      { id: 'w2', text: 'welt', start: 0.6, end: 1.05 },
    ];
    const hashA = await computeTranscriptWordsHash(words);
    const hashB = await computeTranscriptWordsHash(
      words.map((word) => ({ ...word, start: word.start + 1e-9 })),
    );
    expect(hashA).toMatch(/^[0-9a-f]{64}$/);
    expect(hashA).toBe(hashB);

    const hashC = await computeTranscriptWordsHash([
      { ...words[0], text: 'Hallo' },
      words[1],
    ]);
    expect(hashC).not.toBe(hashA);
  });
});
