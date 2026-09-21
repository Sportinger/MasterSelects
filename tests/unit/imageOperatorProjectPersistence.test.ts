import { describe, expect, it } from 'vitest';
import { convertCompositions } from '../../src/services/project/projectCompositionSerialization';
import { convertProjectCompositionToStore } from '../../src/services/project/load/loadTimelineHydration';
import { createDefaultInvertImageGraph } from '../../src/services/operators/imageOperatorGraph';
import type { Composition } from '../../src/stores/mediaStore';
import { createDefaultUvDistortGraph } from '../../src/services/operators/uvDistortEffectGraphs';
import { effectOperatorGraph } from '../../src/services/operators/effectGraphOwner';

function compositionWithGraph(version = 1): Composition {
  const graph = createDefaultInvertImageGraph();
  graph.version = version;
  graph.nodes.find(node => node.id === 'one')!.constants = { value: 0.6 };
  graph.layout.one = { x: 641, y: 412 };
  graph.groups = [{ id: 'edited', label: 'Edited invert', color: '#123456', nodeIds: ['one'] }];
  const transform = { x: 0, y: 0, z: 0, scaleX: 1, scaleY: 1, rotation: 0,
    anchorX: 0, anchorY: 0, opacity: 1, blendMode: 'normal' };
  return {
    id: 'comp', name: 'Operator persistence', type: 'composition', parentId: null, createdAt: 0,
    width: 1920, height: 1080, duration: 1, frameRate: 30, backgroundColor: '#000000',
    timelineData: {
      tracks: [{ id: 'track', name: 'Video', type: 'video', height: 60, locked: false, visible: true, muted: false, solo: false }],
      clips: [{ id: 'clip', trackId: 'track', name: 'Clip', mediaFileId: 'media', sourceType: 'video',
        startTime: 0, duration: 1, inPoint: 0, outPoint: 1, transform, masks: [], keyframes: [],
        effects: [{ id: 'invert', name: 'Invert', type: 'invert', enabled: true,
          params: { operatorGraph: JSON.stringify(createDefaultInvertImageGraph()) }, operatorGraph: graph }] }],
      duration: 1,
    },
  } as unknown as Composition;
}

describe('image operator project persistence', () => {
  it('saves reusable instances and restores their stable editable interiors', () => {
    const composition = compositionWithGraph(), effect = composition.timelineData!.clips[0].effects[0];
    effect.type = 'kaleidoscope'; effect.params = { segments: 6, rotation: .2 };
    effect.operatorGraph = createDefaultUvDistortGraph('kaleidoscope');
    const [restored] = convertProjectCompositionToStore(JSON.parse(JSON.stringify(convertCompositions([composition]))));
    const loaded = restored.timelineData!.clips[0].effects[0];
    expect(loaded.operatorGraph?.nodes).toHaveLength(14);
    expect(loaded.operatorGraph?.compositionRules).toBe(1);
    expect(effectOperatorGraph(loaded).groups?.filter(group => group.composition)).toHaveLength(3);
    expect(effectOperatorGraph(loaded).nodes.find(node => node.id === 'base-angle')?.operator).toBe('math.atan2.scalar');
  });
  it('round-trips the canonical graph and removes the legacy params copy', () => {
    const saved = convertCompositions([compositionWithGraph()]);
    expect(saved[0].clips[0].effects[0].params).not.toHaveProperty('operatorGraph');
    const [restored] = convertProjectCompositionToStore(JSON.parse(JSON.stringify(saved)));
    const effect = restored.timelineData!.clips[0].effects[0];
    expect(effect.params).not.toHaveProperty('operatorGraph');
    expect(effect.operatorGraph?.nodes.find(node => node.id === 'one')?.constants).toEqual({ value: 0.6 });
    expect(effect.operatorGraph?.layout.one).toEqual({ x: 641, y: 412 });
    expect(effect.operatorGraph?.groups).toEqual([{ id: 'edited', label: 'Edited invert', color: '#123456', nodeIds: ['one'] }]);
  });

  it('rejects unsupported saved graph versions instead of replacing them with defaults', () => {
    expect(() => convertCompositions([compositionWithGraph(99)])).toThrow();
  });
});
