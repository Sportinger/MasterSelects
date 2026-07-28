import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { repairTranscriptDuplicates } from '../../src/services/transcription/repairTranscriptDuplicates';
import type {
  TranscriptFusionArtifact,
  TranscriptProviderRun,
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

function runWords(
  runId: string,
  offset: number,
  annotations: boolean = false,
): TranscriptWord[] {
  return ['Hello', 'brave', 'world'].map((text, index) => ({
    id: `${runId}:word-${index}`,
    text,
    start: index * 0.5 + offset,
    end: index * 0.5 + 0.35 + offset,
    confidence: annotations ? 0.8 : 0.96,
    ...(annotations && index === 0 ? {
      alignedStart: 0.02,
      alignedEnd: 0.34,
      alignmentConfidence: 0.9,
      alignmentMethod: 'acoustic-refine' as const,
      emphasis: 0.7,
      speaker: 'Speaker 2',
      speakerConfidence: 0.88,
      speakerSourceProvider: 'openai' as const,
    } : {}),
  }));
}

function providerRun(id: string, createdAt: number, words: TranscriptWord[]): TranscriptProviderRun {
  return {
    id,
    provider: 'deepgram',
    model: 'nova',
    language: 'en',
    range: [0, 2],
    createdAt,
    words,
  };
}

function artifact(
  oldRun: TranscriptProviderRun,
  canonicalRun: TranscriptProviderRun,
  words: TranscriptWord[],
): TranscriptFusionArtifact {
  return {
    schemaVersion: 1,
    primaryProvider: 'deepgram',
    createdAt: canonicalRun.createdAt,
    rawRuns: [oldRun, canonicalRun],
    words,
    conflicts: [],
    patches: [
      {
        id: 'old-patch', conflictId: 'old', source: 'deterministic',
        operation: 'reassign-speaker', wordIds: [oldRun.words[0].id],
        before: 'Speaker 1', after: 'Speaker 2', confidence: 1, reason: 'old',
      },
      {
        id: 'kept-patch', conflictId: 'new', source: 'deterministic',
        operation: 'reassign-speaker', wordIds: [canonicalRun.words[0].id],
        before: 'Speaker 1', after: 'Speaker 2', confidence: 1, reason: 'new',
      },
    ],
    agent: { status: 'not-requested' },
  };
}

describe('repairTranscriptDuplicates', () => {
  beforeEach(() => {
    mediaStoreHarness.state.files = [];
    useTimelineStore.setState(initialTimelineState);
    saveTranscriptMock.mockClear();
  });

  it('keeps the latest Deepgram run and copies missing annotations from discarded twins', async () => {
    const oldWords = runWords('deepgram-0-2000-100', 0, true);
    const canonicalWords = runWords('deepgram-0-2000-200', 0.14);
    const oldRun = providerRun('deepgram-0-2000-100', 100, oldWords);
    const canonicalRun = providerRun('deepgram-0-2000-200', 200, canonicalWords);
    const polluted = [...oldWords, ...canonicalWords].toSorted((a, b) => a.start - b.start);
    const transcriptArtifact = artifact(oldRun, canonicalRun, polluted);
    useMediaStore.setState({
      files: [{
        id: 'media-1', name: 'speech.wav', type: 'audio', parentId: null,
        createdAt: 1, url: 'blob:speech', duration: 2,
        transcriptStatus: 'ready', transcript: polluted, transcriptArtifact,
        transcribedRanges: [[0, 2]],
      }],
    });
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'clip-1', mediaFileId: 'media-1', transcript: polluted }),
        createMockClip({
          id: 'clip-2', source: { type: 'audio', mediaFileId: 'media-1' }, transcript: polluted,
        }),
        createMockClip({ id: 'other', mediaFileId: 'media-2', transcript: polluted }),
      ],
    });

    await expect(repairTranscriptDuplicates('media-1')).resolves.toEqual({
      removed: 3,
      kept: 3,
      runsDetected: 2,
    });

    const repairedMedia = useMediaStore.getState().files[0];
    expect(repairedMedia.transcript?.map(word => word.id)).toEqual(canonicalWords.map(word => word.id));
    expect(repairedMedia.transcript?.[0]).toMatchObject({
      id: canonicalWords[0].id,
      start: canonicalWords[0].start,
      alignedStart: 0.02,
      alignedEnd: 0.34,
      emphasis: 0.7,
      speaker: 'Speaker 2',
      speakerSourceProvider: 'openai',
    });
    expect(repairedMedia.transcriptArtifact?.patches.map(patch => patch.id))
      .toEqual(['kept-patch']);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-1')?.transcript)
      .toBe(repairedMedia.transcript);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'clip-2')?.transcript)
      .toBe(repairedMedia.transcript);
    expect(useTimelineStore.getState().clips.find(clip => clip.id === 'other')?.transcript)
      .toBe(polluted);
    expect(saveTranscriptMock).toHaveBeenCalledWith(
      'media-1',
      expect.objectContaining({ words: repairedMedia.transcript }),
      [[0, 2]],
    );

    await expect(repairTranscriptDuplicates('media-1')).resolves.toEqual({
      removed: 0,
      kept: 3,
      runsDetected: 1,
    });
  });

  it('preserves two-token and isolated repeated speech', async () => {
    const words: TranscriptWord[] = [
      { id: 'deepgram-0-1000-100:word-0', text: 'yes', start: 0, end: 0.2 },
      { id: 'deepgram-0-1000-100:word-1', text: 'yes', start: 0.3, end: 0.5 },
      { id: 'deepgram-0-1000-200:word-0', text: 'YES', start: 0.12, end: 0.32 },
      { id: 'deepgram-0-1000-200:word-1', text: 'YES', start: 0.42, end: 0.62 },
    ];
    useMediaStore.setState({
      files: [{
        id: 'media-1', name: 'speech.wav', type: 'audio', parentId: null,
        createdAt: 1, url: 'blob:speech', transcript: words,
      }],
    });

    await expect(repairTranscriptDuplicates('media-1')).resolves.toEqual({
      removed: 0,
      kept: 4,
      runsDetected: 2,
    });
    expect(useMediaStore.getState().files[0].transcript).toBe(words);
    expect(saveTranscriptMock).not.toHaveBeenCalled();
  });
});
