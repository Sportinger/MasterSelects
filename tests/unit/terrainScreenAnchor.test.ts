import { describe, expect, it } from 'vitest';
import { layerPositionForTerrainScreenAnchor, resolveTerrainScreenAnchor, resolveTerrainScreenAnchors } from '../../src/engine/render/terrainScreenAnchor';
import type { Layer } from '../../src/types/layers';

const layer = {
  id: 'card-layer', name: 'Card', visible: true, opacity: 1, blendMode: 'normal', source: { type: 'text' }, effects: [],
  position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0,
  terrainScreenAnchor: {
    anchor: { attachment: { version: 1, targetVideoClipId: 'tracked-video', trackId: 'terrain-track', placement: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, visible: true }, offset: { x: .1, y: -.2 } },
    terrain: {
      version: 1, solver: 'colmap-openmvs', referenceTime: 1,
      intrinsics: { width: 100, height: 100, fx: 100, fy: 100, cx: 50, cy: 50 },
      cameras: [{ time: 1, duration: .033, rotation: [1, 0, 0, 0, 1, 0, 0, 0, 1], translation: [0, 0, 0], error: 0, observations: 1 }],
      denseMesh: { positions: [-1, -1, 4, 1, -1, 4, 1, 1, 4], indices: [0, 1, 2], origin: [0, 0, 4], axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, -1], size: [2, 2] },
      vertices: [], triangles: [], sourceFrameCount: 1, sparsePointCount: 0, medianError: 0,
    },
  },
} as Layer;

describe('terrain screen anchors', () => {
  it('keeps native content screen-facing at the decoded terrain contact plus editable offset', () => {
    expect(resolveTerrainScreenAnchor(layer, new Map())).toBeNull();
    const resolved = resolveTerrainScreenAnchor(layer, new Map([['tracked-video', 1.01]]));
    expect(resolved).toMatchObject({ contact: { x: .5, y: .5 }, content: { x: .6, y: .3 } });
    const position = layerPositionForTerrainScreenAnchor(layer, resolved!).position;
    expect(position.x).toBeCloseTo(.2);
    expect(position.y).toBeCloseTo(-.4);
  });
  it('retains authored position offsets and hides frames outside camera coverage', () => {
    const moved = { ...layer, position: { x: .2, y: -.1, z: 0 } };
    const resolved = resolveTerrainScreenAnchor(moved, new Map([['tracked-video', 1.01]]));
    expect(layerPositionForTerrainScreenAnchor(moved, resolved!).position.x).toBeCloseTo(.4);
    expect(layerPositionForTerrainScreenAnchor(moved, resolved!).position.y).toBeCloseTo(-.5);
    expect(resolveTerrainScreenAnchor(moved, new Map([['tracked-video', 2]]))).toBeNull();
  });
  it('keeps an opted-in tracked card inside its authored safe area',()=>{
    const bounded=structuredClone(layer);
    bounded.terrainScreenAnchor!.anchor.offset={x:1,y:-1};
    bounded.terrainScreenAnchor!.anchor.contentBounds={left:.12,right:.88,top:.16,bottom:.85};
    expect(resolveTerrainScreenAnchor(bounded,new Map([['tracked-video',1.01]]))?.content).toEqual({x:.88,y:.16});
  });
  it('places grouped cards without overlap and reuses that resolved center for connectors',()=>{
    const cards=Array.from({length:4},(_,index)=>{
      const item=structuredClone(layer);item.id=`card-${index}`;
      item.terrainScreenAnchor!.anchor.labelLayout={group:'test',width:.19,height:.05};
      return item;
    });
    const result=resolveTerrainScreenAnchors(cards,new Map([['tracked-video',1.01]]));
    expect(result.size).toBe(4);
    const centers=[...result.values()].map(value=>value.content);
    for(let i=0;i<centers.length;i++)for(let j=i+1;j<centers.length;j++){
      expect(Math.abs(centers[i].x-centers[j].x)>=.19||Math.abs(centers[i].y-centers[j].y)>=.05).toBe(true);
    }
  });
});
