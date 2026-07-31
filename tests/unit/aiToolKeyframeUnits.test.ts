import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import {
  handleAddKeyframe,
  handleGetKeyframes,
} from '../../src/services/aiTools/handlers/keyframes';

/**
 * Position keyframes are authored in pixels and stored normalized. Before this
 * was wired up, `addKeyframe({ property: 'position.y', value: 113 })` wrote 113
 * straight into the store, and the properties panel — which renders
 * `value * (compHeight / 2)` — displayed 61020 px. The clip sat far off screen,
 * which looked like "the animation only does something at the very start".
 */

const COMP_WIDTH = 1920;
const COMP_HEIGHT = 1080;
const CLIP_ID = 'clip-keyframe-units';
const initialMediaState = useMediaStore.getState();

function seedStores(): void {
  useTimelineStore.setState({
    clips: [{
      id: CLIP_ID,
      trackId: 'video-1',
      type: 'video',
      startTime: 0,
      duration: 5,
      inPoint: 0,
      outPoint: 5,
    }] as never,
    clipKeyframes: new Map(),
  } as never);

  vi.mocked(useMediaStore.getState).mockReturnValue({
    ...initialMediaState,
    activeCompositionId: 'comp-1',
    compositions: [{
      id: 'comp-1',
      width: COMP_WIDTH,
      height: COMP_HEIGHT,
    } as never],
  } as never);
}

function storedKeyframes() {
  return useTimelineStore.getState().getClipKeyframes(CLIP_ID);
}

describe('keyframe position units', () => {
  beforeEach(() => {
    seedStores();
  });

  it('stores a pixel position keyframe normalized against the composition half-extent', async () => {
    const result = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'position.y', value: 113, time: 0 },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    const stored = storedKeyframes().find((kf) => kf.property === 'position.y');
    // 113 px / (1080 / 2) — the same conversion the properties panel inverts.
    expect(stored?.value).toBeCloseTo(113 / (COMP_HEIGHT / 2), 10);
    // The old behaviour wrote the raw number, which displayed as 61020 px.
    expect(stored?.value).not.toBe(113);
  });

  it('reads position keyframes back in the pixels they were authored in', async () => {
    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'position.y', value: 113, time: 0 },
      useTimelineStore.getState(),
    );
    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'position.x', value: -240, time: 1 },
      useTimelineStore.getState(),
    );

    const result = await handleGetKeyframes(
      { clipId: CLIP_ID },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    const keyframes = (result.data as { keyframes: { property: string; value: number }[] }).keyframes;
    const y = keyframes.find((kf) => kf.property === 'position.y');
    const x = keyframes.find((kf) => kf.property === 'position.x');
    expect(y?.value).toBeCloseTo(113, 6);
    expect(x?.value).toBeCloseTo(-240, 6);
  });

  it('leaves non-position properties untouched', async () => {
    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'scale.all', value: 1.8, time: 0 },
      useTimelineStore.getState(),
    );
    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'opacity', value: 0.5, time: 1 },
      useTimelineStore.getState(),
    );

    const scale = storedKeyframes().find((kf) => kf.property === 'scale.all');
    const opacity = storedKeyframes().find((kf) => kf.property === 'opacity');
    expect(scale?.value).toBe(1.8);
    expect(opacity?.value).toBe(0.5);
  });

  it('keeps 3D position keyframes in raw scene units', async () => {
    useTimelineStore.setState({
      clips: useTimelineStore.getState().clips.map((clip) => ({ ...clip, is3D: true })),
    });

    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'position.x', value: 2.5, time: 0 },
      useTimelineStore.getState(),
    );

    const stored = storedKeyframes().find((keyframe) => keyframe.property === 'position.x');
    expect(stored?.value).toBe(2.5);
  });

  it('returns the exact inserted keyframe id even when it is not last in time order', async () => {
    await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'opacity', value: 0.8, time: 4 },
      useTimelineStore.getState(),
    );
    const result = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'opacity', value: 0.2, time: 1 },
      useTimelineStore.getState(),
    );
    const inserted = storedKeyframes().find((keyframe) => (
      keyframe.property === 'opacity' && keyframe.time === 1
    ));

    expect(result.success).toBe(true);
    expect((result.data as { keyframeId: string }).keyframeId).toBe(inserted?.id);
  });

  it('rejects unknown properties and invalid authoring values before writing', async () => {
    const unknown = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'missing.property', value: 1, time: 1 },
      useTimelineStore.getState(),
    );
    const invalidOpacity = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'opacity', value: 2, time: 1 },
      useTimelineStore.getState(),
    );

    expect(unknown.success).toBe(false);
    expect(invalidOpacity.success).toBe(false);
    expect(storedKeyframes()).toHaveLength(0);
  });
});
