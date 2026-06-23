import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { updateClipTranscript } from '../../src/services/transcription/artifactPersistence';
import type { TranscriptWord } from '../../src/types';
import { createMockClip } from '../helpers/mockData';

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
});
