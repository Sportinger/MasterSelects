import { describe, expect, it } from 'vitest';

import { hasCompositionSourceTopologyChanged } from '../../src/hooks/engine/compositionSourceTopology';
import type { TimelineClip } from '../../src/types/timeline';

function clip(overrides: Partial<TimelineClip> = {}): TimelineClip {
  const canvas = document.createElement('canvas');
  return {
    id: 'clip-1',
    trackId: 'video-1',
    name: 'Text',
    file: new File([], 'text.dat'),
    startTime: 0,
    duration: 5,
    inPoint: 0,
    outPoint: 5,
    source: { type: 'text', textCanvas: canvas, naturalDuration: 5 },
    transform: {
      opacity: 1,
      blendMode: 'normal',
      position: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1 },
      rotation: { x: 0, y: 0, z: 0 },
    },
    effects: [],
    ...overrides,
  } as TimelineClip;
}

describe('composition source topology', () => {
  it('detects added and removed layers', () => {
    const first = clip();
    const second = clip({ id: 'clip-2' });

    expect(hasCompositionSourceTopologyChanged([first], [first, second])).toBe(true);
    expect(hasCompositionSourceTopologyChanged([first, second], [first])).toBe(true);
  });

  it('detects source replacement or source-type conversion', () => {
    const first = clip();
    const replacementCanvas = document.createElement('canvas');

    expect(hasCompositionSourceTopologyChanged([first], [{
      ...first,
      source: { ...first.source!, textCanvas: replacementCanvas },
    }])).toBe(true);
    expect(hasCompositionSourceTopologyChanged([first], [{
      ...first,
      source: { type: 'motion' },
    } as TimelineClip])).toBe(true);
  });

  it('ignores transform-only edits that use the same runtime source', () => {
    const first = clip();
    const moved = {
      ...first,
      transform: {
        ...first.transform,
        position: { x: 0.5, y: -0.25, z: 0 },
      },
    };

    expect(hasCompositionSourceTopologyChanged([first], [moved])).toBe(false);
  });
});
