import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useTimelineStore } from '../../src/stores/timeline';
import { useMediaStore } from '../../src/stores/mediaStore';
import { Logger } from '../../src/services/logger';
import { handleAddKeyframe } from '../../src/services/aiTools/handlers/keyframes';
import { propertyRegistry } from '../../src/services/properties';
import { describePropertyAuthoringDescriptor } from '../../src/services/properties/propertyAuthoring';
import { CLIP_SPEED_MIN_MULTIPLIER } from '../../src/stores/timeline/helpers/linkedClipSpeed';
import { createMockClip } from '../helpers/mockData';

/**
 * `addKeyframe({ property: 'speed', value: 0 })` used to answer only
 * "Keyframe was not written: <clip>/speed": the speed descriptor advertised
 * -8..8 while the store silently dropped every |speed| below 0.1.
 */

const CLIP_ID = 'clip-speed-keyframes';
const initialMediaState = useMediaStore.getState();

function speedKeyframes() {
  return useTimelineStore.getState().getClipKeyframes(CLIP_ID)
    .filter((keyframe) => keyframe.property === 'speed');
}

describe('speed keyframe authoring', () => {
  beforeEach(() => {
    Logger.clear();
    useTimelineStore.setState({
      clips: [createMockClip({
        id: CLIP_ID,
        trackId: 'video-1',
        source: { type: 'video' } as never,
      })],
      tracks: [],
      clipKeyframes: new Map(),
    } as never);
    vi.mocked(useMediaStore.getState).mockReturnValue({
      ...initialMediaState,
      activeCompositionId: 'comp-1',
      compositions: [{ id: 'comp-1', width: 1920, height: 1080 } as never],
    } as never);
  });

  it.each([0, 0.01, -0.05])('rejects speed %s with the minimum-magnitude constraint', async (value) => {
    const result = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'speed', value, time: 0 },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      `speed must be at least ${CLIP_SPEED_MIN_MULTIPLIER} or at most -${CLIP_SPEED_MIN_MULTIPLIER}`,
    );
    expect(result.error).not.toContain('Keyframe was not written');
    expect(speedKeyframes()).toHaveLength(0);
  });

  it.each([0.5, -2])('writes a valid speed keyframe of %s', async (value) => {
    const result = await handleAddKeyframe(
      { clipId: CLIP_ID, property: 'speed', value, time: 0 },
      useTimelineStore.getState(),
    );

    expect(result.success).toBe(true);
    expect(speedKeyframes().map((keyframe) => keyframe.value)).toEqual([value]);
  });

  it('reports the constraint in the property descriptor', () => {
    const descriptor = propertyRegistry.getDescriptor('speed', useTimelineStore.getState().clips[0]);
    expect(descriptor).toBeDefined();
    expect(describePropertyAuthoringDescriptor(descriptor!).range)
      .toMatchObject({ min: -8, max: 8, minMagnitude: CLIP_SPEED_MIN_MULTIPLIER });
  });

  it('logs instead of silently dropping an invalid speed in the store', () => {
    useTimelineStore.getState().addKeyframe(CLIP_ID, 'speed', 0, 0);

    expect(speedKeyframes()).toHaveLength(0);
    const warnings = Logger.search('Speed keyframe rejected')
      .filter((entry) => entry.level === 'WARN');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.data).toMatchObject({ clipId: CLIP_ID, value: 0 });
  });
});
