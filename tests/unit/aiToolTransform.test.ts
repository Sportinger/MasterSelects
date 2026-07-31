import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleSetTransform } from '../../src/services/aiTools/handlers/transform';
import { useMediaStore } from '../../src/stores/mediaStore';
import { DEFAULT_TRANSFORM, useTimelineStore } from '../../src/stores/timeline';
import type { TimelineClip } from '../../src/types';

const initialTimelineState = useTimelineStore.getState();
const initialMediaState = useMediaStore.getState();

function createClip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.mp4'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'video' },
    transform: structuredClone(DEFAULT_TRANSFORM),
    effects: [],
    ...overrides,
  };
}

describe('AI tool setTransform', () => {
  beforeEach(() => {
    useTimelineStore.setState(initialTimelineState);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    });
  });

  it('updates 3D position, scale, and rotation fields', async () => {
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await handleSetTransform({
      clipId: clip.id,
      x: 192,
      y: -108,
      z: -0.5,
      scaleZ: 2,
      rotationX: 10,
      rotationY: 20,
      rotationZ: 30,
    }, useTimelineStore.getState());

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id)!;
    expect(result.success).toBe(true);
    expect(updated.transform.position.x).toBeCloseTo(0.2);
    expect(updated.transform.position.y).toBeCloseTo(-0.2);
    expect(updated.transform.position.z).toBeCloseTo(-0.5 / (1920 / 2));
    expect(updated.transform.scale).toEqual({ x: 1, y: 1, z: 2 });
    expect(updated.transform.rotation).toEqual({ x: 10, y: 20, z: 30 });
  });

  it('keeps legacy rotation mapped to Z while preserving X and Y', async () => {
    const clip = createClip({
      transform: {
        ...structuredClone(DEFAULT_TRANSFORM),
        rotation: { x: 8, y: -12, z: 0 },
      },
    });
    useTimelineStore.setState({ clips: [clip] });

    await handleSetTransform({
      clipId: clip.id,
      rotation: 45,
    }, useTimelineStore.getState());

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id)!;
    expect(updated.transform.rotation).toEqual({ x: 8, y: -12, z: 45 });
  });

  it('rejects an invalid blend mode without applying sibling transform writes', async () => {
    const clip = createClip();
    useTimelineStore.setState({ clips: [clip] });

    const result = await handleSetTransform({
      clipId: clip.id,
      x: 192,
      blendMode: 'not-a-blend-mode',
    }, useTimelineStore.getState());

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id)!;
    expect(result.success).toBe(false);
    expect(updated.transform).toEqual(clip.transform);
  });

  it.each([
    ['3D clip', createClip({ is3D: true })],
    ['camera clip', createClip({ source: { type: 'camera' } })],
  ])('keeps %s position values in scene units', async (_label, clip) => {
    useTimelineStore.setState({ clips: [clip] });

    const result = await handleSetTransform({
      clipId: clip.id,
      x: 2,
      y: -3,
      z: 4,
    }, useTimelineStore.getState());

    const updated = useTimelineStore.getState().clips.find((entry) => entry.id === clip.id)!;
    expect(result.success).toBe(true);
    expect(updated.transform.position).toEqual({ x: 2, y: -3, z: 4 });
  });
});
