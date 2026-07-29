import { beforeEach, describe, expect, it } from 'vitest';
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

  useMediaStore.setState({
    getActiveComposition: () => ({
      id: 'comp-1',
      width: COMP_WIDTH,
      height: COMP_HEIGHT,
    }),
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
});
