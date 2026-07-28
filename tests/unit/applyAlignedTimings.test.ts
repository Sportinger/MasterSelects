import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  applyAlignedTimingsFromArtifact,
} from '../../src/services/transcription/applyAlignedTimings';
import type { AudioArtifactStore } from '../../src/services/audio/AudioArtifactStore';
import type {
  AudioAnalysisArtifact,
  AudioArtifactRef,
} from '../../src/services/audio/audioArtifactTypes';
import {
  computeTranscriptWordsHash,
  createTranscriptTimingManifest,
  encodeTranscriptTimingPayload,
  timingsToPayload,
  type AlignedWordTiming,
} from '../../src/services/audio/transcriptTimingManifest';
import type { TranscriptWord } from '../../src/types/clipMetadata';
import { createMockClip } from '../helpers/mockData';

const saveTranscriptMock = vi.hoisted(() => vi.fn());
const getTranscribedRangesMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: {
    getTranscribedRanges: getTranscribedRangesMock,
    saveTranscript: saveTranscriptMock,
  },
}));

// tests/setup.ts replaces the media store with a stateless stub; this suite
// needs a stateful one so the service's read-merge-write cycle is observable.
const mediaStoreHarness = vi.hoisted(() => {
  const state: { files: unknown[] } = { files: [] };
  return {
    state,
    store: {
      getState: () => state,
      setState: (partial: unknown) => {
        const next = typeof partial === 'function'
          ? (partial as (current: unknown) => Record<string, unknown>)(state)
          : partial as Record<string, unknown>;
        Object.assign(state, next);
      },
      subscribe: () => () => {},
    },
  };
});
vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: mediaStoreHarness.store }));

const initialTimelineState = useTimelineStore.getState();

const payloadRef: AudioArtifactRef = {
  artifactId: 'timings-payload',
  hash: 'payload-hash',
  size: 12,
  mimeType: 'application/vnd.masterselects.transcript-timing',
  encoding: 'raw',
  storage: { kind: 'memory' },
  createdAt: '2026-07-28T00:00:00.000Z',
};

const manifestRef: AudioArtifactRef = {
  ...payloadRef,
  artifactId: 'timings-manifest',
  hash: 'manifest-hash',
  mimeType: 'application/vnd.masterselects.audio-analysis+json',
  encoding: 'json',
};

function word(id: string, text: string, start: number, end: number): TranscriptWord {
  return { id, text, start, end };
}

function mediaFile(words: TranscriptWord[]): MediaFile {
  return {
    id: 'media-1',
    name: 'Speech.wav',
    type: 'audio',
    parentId: null,
    createdAt: 1,
    url: 'blob:speech',
    transcriptStatus: 'ready',
    transcript: words,
    transcribedRanges: [[0, 2]],
  };
}

async function timingHarness(
  transcriptHash: string,
  timings: AlignedWordTiming[],
): Promise<{ artifact: AudioAnalysisArtifact; artifactStore: AudioArtifactStore }> {
  const manifest = createTranscriptTimingManifest({
    mediaFileId: 'media-1',
    sourceFingerprint: 'audio+transcript',
    sampleRate: 48000,
    channelLayout: { kind: 'mono', channelCount: 1 },
    duration: 2,
    method: 'acoustic-refine',
    transcriptHash,
    wordCount: timings.length,
    timingsPayloadRef: payloadRef,
  });
  const artifact: AudioAnalysisArtifact = {
    schemaVersion: 1,
    id: 'logical-timing-artifact',
    kind: 'transcript-timing',
    mediaFileId: 'media-1',
    sourceFingerprint: 'audio+transcript',
    decoderId: 'audio-buffer',
    decoderVersion: '1',
    analyzerVersion: '1',
    sampleRate: 48000,
    channelLayout: { kind: 'mono', channelCount: 1 },
    duration: 2,
    payloadRefs: [payloadRef],
    manifestRef,
    createdAt: 1,
    stale: false,
    metadata: { transcriptTimingManifest: manifest as never },
  };
  const payload = encodeTranscriptTimingPayload(
    timingsToPayload(timings, 'acoustic-refine'),
  );
  const artifactStore = {
    getAnalysisArtifact: vi.fn().mockResolvedValue(artifact),
    getPayload: vi.fn().mockResolvedValue(new Blob([payload])),
  } as unknown as AudioArtifactStore;
  return { artifact, artifactStore };
}

describe('applyAlignedTimingsFromArtifact', () => {
  beforeEach(() => {
    mediaStoreHarness.state.files = [];
    useTimelineStore.setState(initialTimelineState);
    saveTranscriptMock.mockReset().mockResolvedValue(true);
    getTranscribedRangesMock.mockReset().mockResolvedValue([[0, 2]]);
  });

  it('merges aligned fields, persists them, and propagates every clip copy', async () => {
    const words = [word('w1', 'hello', 0, 0.4), word('w2', 'world', 0.5, 1)];
    useMediaStore.setState({ files: [mediaFile(words)] });
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'clip-top-level', mediaFileId: 'media-1', transcript: words }),
        createMockClip({
          id: 'clip-source',
          source: { type: 'audio', mediaFileId: 'media-1' },
          transcript: words.map(item => ({ ...item })),
        }),
        createMockClip({ id: 'clip-other', mediaFileId: 'media-2', transcript: words }),
      ],
    });
    const timings = [
      { wordId: 'w1', alignedStart: 0.04, alignedEnd: 0.43, confidence: 0.92 },
      { wordId: 'w2', alignedStart: 0.54, alignedEnd: 1.06, confidence: 0.81 },
    ];
    const harness = await timingHarness(await computeTranscriptWordsHash(words), timings);

    const result = await applyAlignedTimingsFromArtifact({
      mediaFileId: 'media-1',
      ...harness,
    });

    expect(result).toEqual({ applied: 2, skipped: null });
    const persistedWords = useMediaStore.getState().files[0].transcript;
    expect(persistedWords?.[0]).toMatchObject({
      alignedStart: expect.closeTo(0.04, 5),
      alignedEnd: expect.closeTo(0.43, 5),
      alignmentConfidence: expect.closeTo(0.92, 5),
      alignmentMethod: 'acoustic-refine',
    });
    expect(persistedWords?.[0]).not.toBe(words[0]);
    expect(words[0].alignedStart).toBeUndefined();
    const clips = useTimelineStore.getState().clips;
    expect(clips.find(clip => clip.id === 'clip-top-level')?.transcript).toBe(persistedWords);
    expect(clips.find(clip => clip.id === 'clip-source')?.transcript).toBe(persistedWords);
    expect(clips.find(clip => clip.id === 'clip-other')?.transcript?.[0].alignedStart).toBeUndefined();
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ words: persistedWords }),
      [[0, 2]],
    );
  });

  it('rejects timings when the provider transcript changed', async () => {
    const original = [word('w1', 'hello', 0, 0.4)];
    const changed = [word('w1', 'goodbye', 0, 0.4)];
    useMediaStore.setState({ files: [mediaFile(changed)] });
    const harness = await timingHarness(await computeTranscriptWordsHash(original), [
      { wordId: 'w1', alignedStart: 0.1, alignedEnd: 0.5, confidence: 0.9 },
    ]);

    await expect(applyAlignedTimingsFromArtifact({ mediaFileId: 'media-1', ...harness }))
      .resolves.toEqual({ applied: 0, skipped: 'stale-transcript' });
    expect(useMediaStore.getState().files[0].transcript).toBe(changed);
    expect(saveTranscriptMock).not.toHaveBeenCalled();
  });

  it('loads stored coverage ranges when the media copy omits them', async () => {
    const words = [word('w1', 'hello', 0, 0.4)];
    const file = mediaFile(words);
    file.transcribedRanges = undefined;
    useMediaStore.setState({ files: [file] });
    const harness = await timingHarness(await computeTranscriptWordsHash(words), [
      { wordId: 'w1', alignedStart: 0.04, alignedEnd: 0.43, confidence: 0.92 },
    ]);

    await applyAlignedTimingsFromArtifact({ mediaFileId: 'media-1', ...harness });

    expect(getTranscribedRangesMock).toHaveBeenCalledWith('media-1');
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.any(Object),
      [[0, 2]],
    );
  });

  it('is idempotent on a second application', async () => {
    const words = [word('w1', 'hello', 0, 0.4)];
    useMediaStore.setState({ files: [mediaFile(words)] });
    const harness = await timingHarness(await computeTranscriptWordsHash(words), [
      { wordId: 'w1', alignedStart: 0.1, alignedEnd: 0.5, confidence: 0.9 },
    ]);
    const input = { mediaFileId: 'media-1', ...harness };

    await expect(applyAlignedTimingsFromArtifact(input))
      .resolves.toEqual({ applied: 1, skipped: null });
    await expect(applyAlignedTimingsFromArtifact(input))
      .resolves.toEqual({ applied: 0, skipped: 'already-applied' });
    expect(saveTranscriptMock).toHaveBeenCalledTimes(1);
  });
});
