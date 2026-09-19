import { describe, expect, it } from 'vitest';

import { PropertyRegistry } from '../../src/services/properties/PropertyRegistry';
import { registerCoreProperties } from '../../src/services/properties/registerCoreProperties';
import type { TimelineClip } from '../../src/types/timeline';

function createClip(): TimelineClip {
  return {
    id: 'clip',
    trackId: 'video-1',
    name: 'Clip',
    file: new File([], 'clip.dat'),
    startTime: 0,
    duration: 1,
    inPoint: 0,
    outPoint: 1,
    source: { type: 'video' },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    isLoading: false,
  };
}

describe('anchor property registry', () => {
  it('creates and updates every anchor axis through normal property authoring', () => {
    const registry = registerCoreProperties(new PropertyRegistry());
    let clip = createClip();
    for (const [property, value] of [['anchor.x', 0.2], ['anchor.y', -0.3], ['anchor.z', 0.4]] as const) {
      const descriptor = registry.getDescriptor(property, clip);
      expect(descriptor?.animatable).toBe(true);
      clip = descriptor!.write(clip, value) as TimelineClip;
    }
    expect(clip.transform.anchor).toEqual({ x: 0.2, y: -0.3, z: 0.4 });
  });
});
