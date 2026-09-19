import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';
import { resolveRenderableSharedSceneCamera } from '../../src/engine/scene/SceneCameraUtils';
import { createFlockPresetDefinition } from '../../src/services/flock/presets/flockPresets';
import { createFlockGroupFromNodes, setFlockNodeParam } from '../../src/services/flock/mutations/flockGraphMutations';
import {
  buildFlockSimToWorldMatrix,
  dragSimPosition,
  flockNudgeDelta,
  flockVectorComponentWrites,
  projectSimPoint,
  transformPoint,
} from '../../src/components/preview/flock/flockGuidanceOverlayMath';
import { buildFlockOutlinePaths, collectFlockGuidanceHandles } from '../../src/components/preview/flock/flockGuidanceHandles';

const canvasSize = { width: 960, height: 540 };
const viewport = { width: 1920, height: 1080 };

function camera() {
  return resolveRenderableSharedSceneCamera(viewport, 0, { clips: [], tracks: [] });
}

describe('flock guidance overlay math', () => {
  it('maps simulation units into the shared scene (100 sim units per world unit)', () => {
    const matrix = buildFlockSimToWorldMatrix(structuredClone(DEFAULT_TRANSFORM));
    const world = transformPoint(matrix, [100, -50, 25]);
    expect(world[0]).toBeCloseTo(1, 6);
    expect(world[1]).toBeCloseTo(-0.5, 6);
    expect(world[2]).toBeCloseTo(0.25, 6);
    const moved = buildFlockSimToWorldMatrix({ ...structuredClone(DEFAULT_TRANSFORM), position: { x: 0.5, y: 0, z: 0 } });
    expect(transformPoint(moved, [0, 0, 0])[0]).toBeCloseTo(0.5, 6);
  });

  it('projects the simulation origin to the canvas center with the default camera', () => {
    const matrix = buildFlockSimToWorldMatrix(structuredClone(DEFAULT_TRANSFORM));
    const screen = projectSimPoint(matrix, [0, 0, 0], camera(), canvasSize);
    expect(screen.visible).toBe(true);
    expect(screen.x).toBeCloseTo(480, 1);
    expect(screen.y).toBeCloseTo(270, 1);
    const right = projectSimPoint(matrix, [40, 0, 0], camera(), canvasSize);
    const up = projectSimPoint(matrix, [0, 40, 0], camera(), canvasSize);
    expect(right.x).toBeGreaterThan(480);
    expect(up.y).toBeLessThan(270);
  });

  it('drags on the camera-facing plane and round-trips to the pointer', () => {
    const matrix = buildFlockSimToWorldMatrix(structuredClone(DEFAULT_TRANSFORM));
    const cam = camera();
    const start: [number, number, number] = [10, -5, 0];
    const startScreen = projectSimPoint(matrix, start, cam, canvasSize);
    const pointer = { x: startScreen.x + 60, y: startScreen.y - 30 };
    const next = dragSimPosition({ camera: cam, canvasSize, simToWorld: matrix, startSim: start, pointer });
    expect(next).not.toBeNull();
    expect(next![0]).toBeGreaterThan(start[0]);
    expect(next![1]).toBeGreaterThan(start[1]);
    expect(next![2]).toBeCloseTo(start[2], 3);
    const nextScreen = projectSimPoint(matrix, next!, cam, canvasSize);
    expect(nextScreen.x).toBeCloseTo(pointer.x, 2);
    expect(nextScreen.y).toBeCloseTo(pointer.y, 2);
  });

  it('writes only changed components on keyframeable flock properties', () => {
    expect(flockVectorComponentWrites('fn-a', 'center', [0, 1, 2], [3, 1, 2])).toEqual([
      { property: 'flock.node.fn-a.center.x', value: 3 },
    ]);
    expect(flockVectorComponentWrites('fn-g', 'fn-inner__position', [0, 0, 0], [0, 2, -1]).map((write) => write.property)).toEqual([
      'flock.node.fn-g.fn-inner__position.y',
      'flock.node.fn-g.fn-inner__position.z',
    ]);
    expect(flockNudgeDelta('ArrowRight', false)).toEqual([1, 0, 0]);
    expect(flockNudgeDelta('PageDown', true)).toEqual([0, 0, -10]);
    expect(flockNudgeDelta('a', false)).toBeNull();
  });
});

describe('flock guidance handles', () => {
  const unkeyed = () => undefined;

  it('collects emitter, vortex and boundary handles with outlines', () => {
    const definition = createFlockPresetDefinition('vortex');
    const handles = collectFlockGuidanceHandles(definition, unkeyed);
    expect(handles.map((handle) => handle.operator).toSorted()).toEqual(['flock.boundary', 'flock.emitter', 'flock.vortex']);
    const matrix = buildFlockSimToWorldMatrix(structuredClone(DEFAULT_TRANSFORM));
    for (const handle of handles) {
      expect(handle.outline).not.toBeNull();
      expect(buildFlockOutlinePaths(handle.outline!, matrix, camera(), canvasSize).length).toBeGreaterThan(0);
    }
  });

  it('uses animated values from the reader and polyline point handles for polyline paths', () => {
    let definition = createFlockPresetDefinition('follow-path');
    const path = definition.nodes.find((node) => node.operator === 'flock.path')!;
    const result = setFlockNodeParam(definition, path.id, 'shape', 'polyline');
    if (!result.ok) throw new Error('mutation failed');
    definition = result.definition;
    const handles = collectFlockGuidanceHandles(definition, (property) => (
      property === `flock.node.${path.id}.p2.x` ? 99 : undefined
    ));
    const pointHandles = handles.filter((handle) => handle.operator === 'flock.path');
    expect(pointHandles.map((handle) => handle.paramKey)).toEqual(['p0', 'p1', 'p2', 'p3']);
    expect(pointHandles[2].sim[0]).toBe(99);
    expect(pointHandles[0].outline?.kind).toBe('polyline');
  });

  it('keys inner group handles on the group instance override', () => {
    const definition = createFlockPresetDefinition('vortex');
    const vortex = definition.nodes.find((node) => node.operator === 'flock.vortex')!;
    const grouped = createFlockGroupFromNodes(definition, [vortex.id], 'Swirl');
    if (!grouped.ok) throw new Error('group failed');
    const handle = collectFlockGuidanceHandles(grouped.definition, unkeyed).find((candidate) => candidate.operator === 'flock.vortex')!;
    expect(handle.ownerNodeId).toBe(grouped.groupNodeId);
    expect(handle.paramKey).toBe(`${vortex.id}__center`);
    expect(handle.label).toContain('Swirl');
  });
});
