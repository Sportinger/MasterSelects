import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useMediaStore } from '../../src/stores/mediaStore';
import { useTimelineStore } from '../../src/stores/timeline';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();
const mediaItemCreators = {
  createCameraItem: vi.fn(),
  createLightItem: vi.fn(),
  createMathSceneItem: vi.fn(),
  createMeshItem: vi.fn(),
  createMotionShapeItem: vi.fn(),
  createSolidItem: vi.fn(),
  createSplatEffectorItem: vi.fn(),
  createTextItem: vi.fn(),
};

describe('timeline-native layer media isolation', () => {
  beforeEach(() => {
    for (const creator of Object.values(mediaItemCreators)) creator.mockClear();
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      ...mediaItemCreators,
    } as ReturnType<typeof useMediaStore.getState>);
    useTimelineStore.setState({
      ...initialTimelineState,
      clips: [],
      tracks: [{
        id: 'video-1',
        name: 'Video 1',
        type: 'video',
        height: 70,
        muted: false,
        visible: true,
        solo: false,
      }],
    });
  });

  it('adds generated layer types directly to the timeline by default', async () => {
    const timeline = useTimelineStore.getState();
    await timeline.addTextClip('video-1', 0, 5);
    timeline.addSolidClip('video-1', 0, '#ffffff', 5);
    timeline.addMeshClip('video-1', 0, 'cube', 5);
    timeline.addCameraClip('video-1', 0, 5);
    timeline.addLightClip('video-1', 0, 5);
    timeline.addSplatEffectorClip('video-1', 0, 5);
    timeline.addMathSceneClip('video-1', 0, 5);
    timeline.addMotionShapeClip('video-1', 0, { primitive: 'rectangle', duration: 5 });

    expect(useTimelineStore.getState().clips).toHaveLength(8);
    expect(Object.values(mediaItemCreators).every((creator) => creator.mock.calls.length === 0))
      .toBe(true);
  });
});
