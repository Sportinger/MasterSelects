import { describe, expect, it } from 'vitest';

import { handleStartMediaTranscription } from '../../src/services/aiTools/handlers/media/library';
import { useMediaStore } from '../../src/stores/mediaStore';

describe('Direct media transcription wait', () => {
  it('returns an already-ready transcript instead of instructing the agent to poll', async () => {
    const mediaStore = {
      ...useMediaStore.getState(),
      files: [{
        id: 'media-ready',
        createdAt: 1,
        duration: 2,
        file: new File(['video'], 'ready.mp4', { type: 'video/mp4' }),
        hasAudio: true,
        name: 'ready.mp4',
        parentId: null,
        transcript: [
          { id: 'word-1', end: 0.4, start: 0.1, text: 'Ready' },
        ],
        transcriptCoverage: 1,
        transcriptStatus: 'ready',
        type: 'video',
        url: 'blob:ready',
      }],
    };

    const result = await handleStartMediaTranscription(
      { mediaFileId: 'media-ready', waitForCompletion: true },
      mediaStore,
    );

    expect(result).toMatchObject({
      success: true,
      data: {
        complete: true,
        mediaFileId: 'media-ready',
        totalWordCount: 1,
        waitStrategy: 'bounded-internal-wait-v1',
        words: [{ text: 'Ready' }],
      },
    });
  });
});
