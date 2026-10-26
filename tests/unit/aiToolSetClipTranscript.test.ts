import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';
import { handleSetClipTranscript, knownTranscriptWords } from '../../src/services/aiTools/handlers/setTranscript';
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
const oldWord = { id: 'word-0', text: 'Old', start: 0.2, end: 0.5 };

describe('setClipTranscript', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    saveTranscriptMock.mockClear();
    useMediaStore.setState({
      files: [{
        id: 'voice-1', name: 'line.wav', type: 'audio', parentId: null, createdAt: 1, url: 'blob:line', duration: 2,
        transcriptStatus: 'ready', transcript: [oldWord], transcribedRanges: [[0, 2]],
      }],
    });
    useTimelineStore.setState({
      clips: [
        createMockClip({ id: 'line-a', mediaFileId: 'voice-1', transcript: [oldWord] }),
        // The second half of a split line shares the media and so the transcript.
        createMockClip({ id: 'line-b', source: { type: 'audio', mediaFileId: 'voice-1' }, transcript: [oldWord] }),
        createMockClip({ id: 'other', mediaFileId: 'voice-2' }),
      ],
    });
  });

  it('replaces the media transcript with the given word times and updates every clip of that media', async () => {
    const result = await handleSetClipTranscript({
      clipId: 'line-a',
      words: [{ text: 'world', start: 0.6, end: 0.9 }, { text: ' Hello ', start: 0.1, end: 0.5 }],
    }, useTimelineStore.getState());

    expect(result).toMatchObject({ success: true, data: { clipId: 'line-a', mediaFileId: 'voice-1', wordCount: 2, savedToProject: true } });
    const media = useMediaStore.getState().files[0];
    expect(media.transcript?.map(word => [word.text, word.start, word.end])).toEqual([['Hello', 0.1, 0.5], ['world', 0.6, 0.9]]);
    expect(media.transcriptStatus).toBe('ready');
    const clips = useTimelineStore.getState().clips;
    expect(clips.find(clip => clip.id === 'line-b')?.transcript?.map(word => word.text)).toEqual(['Hello', 'world']);
    expect(clips.find(clip => clip.id === 'other')?.transcript).toBeUndefined();
    expect(saveTranscriptMock).toHaveBeenCalledOnce();
  });

  it('refuses invalid words with the reason instead of dropping them', async () => {
    expect(knownTranscriptWords([], 'm')).toMatch(/non-empty/);
    expect(knownTranscriptWords([{ text: 'a', start: 1, end: 0.5 }], 'm')).toMatch(/word 0 .*start 1 and end 0.5/);
    expect(knownTranscriptWords([{ text: ' ', start: 0, end: 1 }], 'm')).toMatch(/no text/);
    const result = await handleSetClipTranscript({ clipId: 'line-a', words: [{ text: 'x', start: 'a', end: 1 }] }, useTimelineStore.getState());
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/numeric start and end/) });
    expect(useMediaStore.getState().files[0].transcript).toEqual([oldWord]);
  });

  it('warns about words beyond the media duration and an unknown clip', async () => {
    const result = await handleSetClipTranscript({ clipId: 'line-a', words: [{ text: 'late', start: 1.9, end: 2.4 }] }, useTimelineStore.getState());
    expect(result).toMatchObject({ success: true, data: { warnings: [expect.stringMatching(/after the media's duration/)] } });
    await expect(handleSetClipTranscript({ clipId: 'missing', words: [] }, useTimelineStore.getState()))
      .resolves.toMatchObject({ success: false, error: 'Clip not found: missing' });
  });
});
