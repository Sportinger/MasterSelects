import { describe, expect, it } from 'vitest';
import { createLoadStateGeneratedClip } from '../../src/stores/timeline/serialization/loadStateGeneratedClipRestore';
import { createDefaultWeaveGraph } from '../../src/services/operators/geometry/weaveGraph';
import type { SerializableClip } from '../../src/stores/timeline/types';
import type { Effect } from '../../src/types/effects';

describe('Weave host restore', () => {
  it('keeps a flock host that only carries Weave across save and load', async () => {
    const weave: Effect = { id: 'fx-weave', name: 'Weave', type: 'weave', enabled: true, params: {}, operatorGraph: createDefaultWeaveGraph() };
    // A saved host whose Flocking effect was removed: no swarm definition, only the Weave effect.
    const serializedClip = { id: 'clip-weave', trackId: 'video-1', name: 'Weave', mediaFileId: '', startTime: 0, duration: 10, inPoint: 0,
      outPoint: 10, sourceType: 'flock', naturalDuration: 10, transform: { opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1 }, rotation: { x: 0, y: 0, z: 0 } }, effects: [weave], is3D: true } as unknown as SerializableClip;
    const restored = await createLoadStateGeneratedClip({ serializedClip, mediaStore: { files: [] } as never });
    expect(restored?.source?.type).toBe('flock');
    expect(restored).not.toHaveProperty('flock');
    expect(restored?.effects?.map(effect => effect.type)).toEqual(['weave']);
    expect(restored?.effects?.[0].operatorGraph?.nodes.length).toBe(weave.operatorGraph!.nodes.length);
  });
});
