import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { useTimelineStore } from '../../src/stores/timeline';
import { applyWordEmphasisFromArtifact } from '../../src/services/transcription/applyAlignedTimings';
import type { AudioArtifactStore } from '../../src/services/audio/AudioArtifactStore';
import type { AudioAnalysisArtifact, AudioArtifactRef } from '../../src/services/audio/audioArtifactTypes';
import { createProsodyContourManifest } from '../../src/services/audio/prosodyContourManifest';
import { computeTranscriptWordsHash } from '../../src/services/audio/transcriptTimingManifest';
import type { TranscriptWord } from '../../src/types/clipMetadata';
import { createMockClip } from '../helpers/mockData';

const saveTranscriptMock = vi.hoisted(() => vi.fn());
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: { saveTranscript: saveTranscriptMock },
}));

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
  artifactId: 'prosody-payload',
  hash: 'payload-hash',
  size: 12,
  mimeType: 'application/vnd.masterselects.audio-dense-curve',
  encoding: 'raw',
  storage: { kind: 'memory' },
  createdAt: '2026-07-28T00:00:00.000Z',
};
const manifestRef: AudioArtifactRef = {
  ...payloadRef,
  artifactId: 'prosody-manifest',
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

async function emphasisHarness(
  words: TranscriptWord[],
  wordEmphasis: readonly { wordId: string; emphasis: number; f0MeanHz?: number }[] | undefined,
  stale = false,
): Promise<{ artifact: AudioAnalysisArtifact; artifactStore: AudioArtifactStore }> {
  const transcriptHash = await computeTranscriptWordsHash(words);
  const sourceFingerprint = `audio-fingerprint+transcript=${transcriptHash}`;
  const manifest = createProsodyContourManifest({
    mediaFileId: 'media-1',
    sourceFingerprint,
    sampleRate: 48000,
    analysisSampleRate: 16000,
    channelLayout: { kind: 'mono', channelCount: 1 },
    duration: 2,
    curves: [
      { metric: 'f0-hz', windowDuration: 0.04, hopDuration: 0.01, pointCount: 2, payloadRef },
    ],
    wordEmphasis,
  });
  const artifact: AudioAnalysisArtifact = {
    schemaVersion: 1,
    id: 'logical-prosody-artifact',
    kind: 'prosody-contour',
    mediaFileId: 'media-1',
    sourceFingerprint,
    decoderId: 'audio-buffer',
    decoderVersion: '1',
    analyzerVersion: '1',
    sampleRate: 48000,
    channelLayout: { kind: 'mono', channelCount: 1 },
    duration: 2,
    payloadRefs: [payloadRef],
    manifestRef,
    createdAt: 1,
    stale,
    metadata: { prosodyContourManifest: manifest as never },
  };
  const artifactStore = {
    getAnalysisArtifact: vi.fn().mockResolvedValue(artifact),
  } as unknown as AudioArtifactStore;
  return { artifact, artifactStore };
}

describe('applyWordEmphasisFromArtifact', () => {
  beforeEach(() => {
    mediaStoreHarness.state.files = [];
    useTimelineStore.setState(initialTimelineState);
    saveTranscriptMock.mockReset().mockResolvedValue(true);
  });

  it('merges matching emphasis, preserves timing fields, and propagates clip copies', async () => {
    const words = [
      { ...word('w1', 'hello', 0, 0.4), alignedStart: 0.04, alignedEnd: 0.43, alignmentConfidence: 0.92 },
      word('w2', 'world', 0.5, 1),
    ];
    useMediaStore.setState({ files: [mediaFile(words)] });
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'clip-top-level', mediaFileId: 'media-1', transcript: words }),
        createMockClip({ id: 'clip-other', mediaFileId: 'media-2', transcript: words }),
      ],
    });
    const harness = await emphasisHarness(words, [
      { wordId: 'w1', emphasis: 0.85, f0MeanHz: 126 },
      { wordId: 'missing', emphasis: 0.4 },
    ]);

    await expect(applyWordEmphasisFromArtifact({ mediaFileId: 'media-1', ...harness }))
      .resolves.toEqual({ applied: 1, skipped: null });

    const persistedWords = useMediaStore.getState().files[0].transcript;
    expect(persistedWords?.[0]).toMatchObject({
      emphasis: 0.85,
      alignedStart: 0.04,
      alignedEnd: 0.43,
      alignmentConfidence: 0.92,
    });
    expect(persistedWords?.[1]).toBe(words[1]);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-top-level')?.transcript)
      .toBe(persistedWords);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-other')?.transcript?.[0].emphasis)
      .toBeUndefined();
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ words: persistedWords }),
      [[0, 2]],
    );
  });

  it('is idempotent on a second application', async () => {
    const words = [word('w1', 'hello', 0, 0.4)];
    useMediaStore.setState({ files: [mediaFile(words)] });
    const harness = await emphasisHarness(words, [{ wordId: 'w1', emphasis: 0.7 }]);
    const input = { mediaFileId: 'media-1', ...harness };

    await expect(applyWordEmphasisFromArtifact(input))
      .resolves.toEqual({ applied: 1, skipped: null });
    await expect(applyWordEmphasisFromArtifact(input))
      .resolves.toEqual({ applied: 0, skipped: 'already-applied' });
    expect(saveTranscriptMock).toHaveBeenCalledTimes(1);
  });

  it('skips existing manifests that have no emphasis field', async () => {
    const words = [word('w1', 'hello', 0, 0.4)];
    useMediaStore.setState({ files: [mediaFile(words)] });
    const harness = await emphasisHarness(words, undefined);

    await expect(applyWordEmphasisFromArtifact({ mediaFileId: 'media-1', ...harness }))
      .resolves.toEqual({ applied: 0, skipped: 'no-emphasis' });
    expect(saveTranscriptMock).not.toHaveBeenCalled();
  });

  it('skips stale prosody artifacts', async () => {
    const words = [word('w1', 'hello', 0, 0.4)];
    useMediaStore.setState({ files: [mediaFile(words)] });
    const harness = await emphasisHarness(words, [{ wordId: 'w1', emphasis: 0.7 }], true);

    await expect(applyWordEmphasisFromArtifact({ mediaFileId: 'media-1', ...harness }))
      .resolves.toEqual({ applied: 0, skipped: 'stale-transcript' });
    expect(saveTranscriptMock).not.toHaveBeenCalled();
  });
});