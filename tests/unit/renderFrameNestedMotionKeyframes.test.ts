import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '../../src/types/timeline';
import { useTimelineStore } from '../../src/stores/timeline';
import { buildMotionSource } from '../../src/engine/export/layerBuilder/sourceLookup';
import { mapTimelineClip } from '../../src/services/render/renderFrameTimelineSnapshotMappers';
import { createMd1GoldenFixture } from '../../src/services/motionDesign/evidence/md1GoldenFixture';

function appearanceOpacity(clip: TimelineClip, time: number): number | undefined {
  const source = buildMotionSource(clip, time);
  if (source?.type !== 'motion' || source.motion.kind !== 'shape') return undefined;
  return source.motion.appearance?.items.find((item) => item.id === 'md1-rect-gradient')?.opacity;
}

describe('render-frame nested Motion Design keyframes', () => {
  it('preserves embedded keyframes and evaluates them without a top-level store entry', () => {
    const previous = useTimelineStore.getState().clipKeyframes;
    try {
      useTimelineStore.setState({ clipKeyframes: new Map() });
      const fixture = createMd1GoldenFixture();
      const snapshot = mapTimelineClip(fixture.nestedWrapperClip, new Map());
      const nested = snapshot.nestedClips?.find((clip) => clip.id === 'md1-clip-rectangle');

      expect(nested?.keyframes).toEqual(fixture.keyframes.get('md1-clip-rectangle'));
      expect(nested?.keyframes).not.toBe(fixture.keyframes.get('md1-clip-rectangle'));

      const runtimeNested = nested as unknown as TimelineClip;
      expect(appearanceOpacity(runtimeNested, 0)).toBeCloseTo(0.3, 5);
      expect(appearanceOpacity(runtimeNested, 1)).toBeCloseTo(0.88, 5);
    } finally {
      useTimelineStore.setState({ clipKeyframes: previous });
    }
  });
});
