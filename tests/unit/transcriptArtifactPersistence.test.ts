import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import {
  persistTranscriptCheckpoint,
  propagateTranscriptToMediaFile,
  updateClipTranscript,
} from '../../src/services/transcription/artifactPersistence';
import { mergeTranscriptWords } from '../../src/services/transcription/resultMapping';
import type {
  TranscriptFusionArtifact,
  TranscriptFusionProgress,
  TranscriptWord,
} from '../../src/types/clipMetadata';
import { createMockClip } from '../helpers/mockData';

const saveTranscriptMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
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
    },
  };
});

vi.mock('../../src/stores/mediaStore', () => ({ useMediaStore: mediaStoreHarness.store }));
vi.mock('../../src/services/project/ProjectFileService', () => ({
  projectFileService: { saveTranscript: saveTranscriptMock },
}));

const initialTimelineState = useTimelineStore.getState();

function transcriptWord(text: string): TranscriptWord {
  return {
    id: `word-${text}`,
    text,
    start: 0,
    end: 0.5,
  };
}

describe('transcript artifact persistence', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    mediaStoreHarness.state.files = [];
    saveTranscriptMock.mockClear();
  });

  it('shares transcript updates and clears across directly linked clips', () => {
    const words = [transcriptWord('Hallo')];

    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'video-clip', linkedClipId: 'audio-clip', source: { type: 'video' } }),
        createMockClip({ id: 'audio-clip', linkedClipId: 'video-clip', source: { type: 'audio' } }),
        createMockClip({ id: 'other-clip', source: { type: 'video' } }),
      ],
    });

    updateClipTranscript('audio-clip', {
      status: 'ready',
      progress: 100,
      words,
      message: undefined,
    });

    let clips = useTimelineStore.getState().clips;
    expect(clips.find(clip => clip.id === 'video-clip')?.transcript).toEqual(words);
    expect(clips.find(clip => clip.id === 'audio-clip')?.transcript).toEqual(words);
    expect(clips.find(clip => clip.id === 'other-clip')?.transcript).toBeUndefined();

    updateClipTranscript('video-clip', {
      status: 'none',
      progress: 0,
      words: undefined,
      message: undefined,
    });

    clips = useTimelineStore.getState().clips;
    expect(clips.find(clip => clip.id === 'video-clip')?.transcript).toBeUndefined();
    expect(clips.find(clip => clip.id === 'audio-clip')?.transcript).toBeUndefined();
  });

  it('deduplicates a coherent text run despite provider timing drift', () => {
    const existing = [
      { id: 'old-1', text: 'Hello', start: 0, end: 0.4 },
      { id: 'old-2', text: 'brave', start: 0.5, end: 0.9 },
      { id: 'old-3', text: 'world', start: 1, end: 1.4 },
    ];
    const incoming = [
      { id: 'new-1', text: 'hello,', start: 0.14, end: 0.54 },
      { id: 'new-2', text: 'BRAVE', start: 0.64, end: 1.04 },
      { id: 'new-3', text: 'world!', start: 1.14, end: 1.54 },
    ];

    expect(mergeTranscriptWords(existing, incoming).map(word => word.id))
      .toEqual(['old-1', 'old-2', 'old-3']);
  });

  it('keeps an isolated repeated token outside strict timing tolerance', () => {
    const existing = [{ id: 'old', text: 'yes', start: 1, end: 1.2 }];
    const incoming = [{ id: 'new', text: 'YES!', start: 1.12, end: 1.32 }];

    expect(mergeTranscriptWords(existing, incoming)).toHaveLength(2);
  });

  it('retains strict timing dedupe as a fallback outside coherent text runs', () => {
    const existing = [{ id: 'old', text: 'alpha', start: 1, end: 1.2 }];
    const incoming = [{ id: 'new', text: 'different', start: 1.02, end: 1.22 }];

    expect(mergeTranscriptWords(existing, incoming).map(word => word.id)).toEqual(['old']);
  });

  it('range-replaces media words and preserves words outside the authoritative span', () => {
    const outsideBefore = { id: 'before', text: 'before', start: 0.1, end: 0.4 };
    const replaced = { id: 'old', text: 'old', start: 1.1, end: 1.4 };
    const outsideAfter = { id: 'after', text: 'after', start: 2.1, end: 2.4 };
    const replacement = { id: 'new', text: 'new', start: 1.2, end: 1.5 };
    useMediaStore.setState({
      files: [{
        id: 'media-1', name: 'speech.wav', type: 'audio', parentId: null,
        createdAt: 1, url: 'blob:speech', duration: 3,
        transcript: [outsideBefore, replaced, outsideAfter],
        transcribedRanges: [[0, 0.5]],
      }],
    });

    propagateTranscriptToMediaFile('media-1', [replacement], [[1, 2]]);

    expect(useMediaStore.getState().files[0].transcript?.map(word => word.id))
      .toEqual(['before', 'new', 'after']);
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ words: [outsideBefore, replacement, outsideAfter] }),
      [[0, 0.5], [1, 2]],
    );
  });

  it('allows an authoritative silent range to clear stale media words', () => {
    useMediaStore.setState({
      files: [{
        id: 'media-1', name: 'speech.wav', type: 'audio', parentId: null,
        createdAt: 1, url: 'blob:speech', duration: 2,
        transcript: [{ id: 'stale', text: 'stale', start: 0.2, end: 0.5 }],
      }],
    });

    propagateTranscriptToMediaFile('media-1', [], [[0, 2]]);

    expect(useMediaStore.getState().files[0].transcript).toEqual([]);
    expect(useMediaStore.getState().files[0].transcribedRanges).toEqual([[0, 2]]);
  });

  it('durably saves a completed chunk while keeping the larger run active', async () => {
    const checkpointWord = { id: 'checkpoint', text: 'saved', start: 0.2, end: 0.6 };
    const artifact: TranscriptFusionArtifact = {
      agent: { status: 'not-requested' },
      conflicts: [],
      createdAt: 1,
      patches: [],
      primaryProvider: 'deepgram',
      providerStatuses: { deepgram: 'complete', openai: 'complete' },
      rawRuns: [],
      schemaVersion: 1,
      words: [checkpointWord],
    };
    const progress: TranscriptFusionProgress = {
      conflictCount: 0,
      mergeProgress: 0,
      providerProgress: {
        deepgram: { completedChunks: 1, totalChunks: 3, percent: 33 },
        openai: { completedChunks: 1, totalChunks: 3, percent: 33 },
      },
      providers: { deepgram: 'running', openai: 'running' },
      range: [0, 1],
      resolvedCount: 0,
      stage: 'transcribing',
      updatedAt: 1,
    };
    useMediaStore.setState({
      files: [{
        id: 'media-1', name: 'speech.wav', type: 'audio', parentId: null,
        createdAt: 1, url: 'blob:speech', duration: 3,
      }],
    });

    await expect(persistTranscriptCheckpoint(
      'media-1',
      [checkpointWord],
      [[0, 1]],
      artifact,
      progress,
    )).resolves.toBe(true);

    expect(useMediaStore.getState().files[0]).toMatchObject({
      transcriptStatus: 'transcribing',
      transcribedRanges: [[0, 1]],
      transcriptFusionProgress: progress,
    });
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ artifact: expect.any(Object), words: [checkpointWord] }),
      [[0, 1]],
    );
  });
});
