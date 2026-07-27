import { afterEach, describe, expect, it } from 'vitest';

import { resolveLocalImportAppendPoint } from '../../src/services/aiTools/handlers/media/localImport';
import { resolveYouTubeAppendPoint } from '../../src/services/aiTools/handlers/youtube';
import { useTimelineStore } from '../../src/stores/timeline';
import { createMockClip, createMockTrack } from '../helpers/mockData';

const initialTimelineState = useTimelineStore.getState();

describe('AI tool occupancy migration', () => {
  afterEach(() => {
    useTimelineStore.setState(initialTimelineState);
  });

  it('uses the canonical occupied end for YouTube appends and preserves the empty fallback', () => {
    const videoTrack = createMockTrack({ id: 'video-1' });
    const audioTrack = createMockTrack({ id: 'audio-1', type: 'audio' });
    useTimelineStore.setState({
      tracks: [videoTrack, audioTrack],
      clips: [
        createMockClip({ id: 'video-clip', trackId: videoTrack.id, startTime: 2, duration: 4 }),
        createMockClip({ id: 'audio-clip', trackId: audioTrack.id, startTime: 7, duration: 5 }),
      ],
    });

    expect(resolveYouTubeAppendPoint()).toBe(12);

    useTimelineStore.setState({ clips: [] });
    expect(resolveYouTubeAppendPoint()).toBe(0);
  });

  it('uses the target track occupied end for local imports and preserves its empty fallback', () => {
    const targetTrack = createMockTrack({ id: 'video-1' });
    const otherTrack = createMockTrack({ id: 'video-2' });
    useTimelineStore.setState({
      tracks: [targetTrack, otherTrack],
      clips: [
        createMockClip({ id: 'target-clip', trackId: targetTrack.id, startTime: 3, duration: 6 }),
        createMockClip({ id: 'other-clip', trackId: otherTrack.id, startTime: 20, duration: 10 }),
      ],
    });

    expect(resolveLocalImportAppendPoint(targetTrack.id)).toBe(9);

    useTimelineStore.setState({ clips: [] });
    expect(resolveLocalImportAppendPoint(targetTrack.id)).toBe(0);
  });
});
