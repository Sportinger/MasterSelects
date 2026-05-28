import { beforeEach, describe, expect, it } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

describe('audio region edit range updates', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('moves an existing region edit instead of duplicating it', () => {
    const clip = createMockClip({
      id: 'audio-clip',
      trackId: 'audio-1',
      file: new File([], 'clip.wav', { type: 'audio/wav' }),
      source: { type: 'audio' },
      startTime: 10,
      duration: 5,
      inPoint: 2,
      outPoint: 7,
      audioState: {
        editStack: [{
          id: 'gain-1',
          type: 'gain',
          enabled: true,
          params: {
            label: 'Region gain',
            timelineStart: 11,
            timelineEnd: 13,
            gainDb: -6,
            fadeInSeconds: 0.05,
            fadeOutSeconds: 0.05,
          },
          timeRange: { start: 3, end: 5 },
          createdAt: 100,
        }],
        processedAnalysisRefs: {
          processedWaveformPyramidId: 'processed-old',
        },
      },
    });

    useTimelineStore.setState({
      clips: [clip],
      tracks: [createMockTrack({ id: 'audio-1', type: 'audio' })],
    });

    useTimelineStore.getState().setClipAudioEditOperationRange('audio-clip', ['gain-1'], {
      clipId: 'audio-clip',
      trackId: 'audio-1',
      startTime: 12,
      endTime: 14,
      sourceInPoint: 4,
      sourceOutPoint: 6,
    });

    const updated = useTimelineStore.getState().clips[0];
    expect(updated.audioState?.editStack).toHaveLength(1);
    expect(updated.audioState?.editStack?.[0]).toMatchObject({
      id: 'gain-1',
      type: 'gain',
      timeRange: { start: 4, end: 6 },
      params: {
        timelineStart: 12,
        timelineEnd: 14,
        gainDb: -6,
      },
    });
    expect(updated.audioState?.processedAnalysisRefs).toBeUndefined();
  });
});
