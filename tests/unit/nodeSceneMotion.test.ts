import { describe, expect, it } from 'vitest';
import { NodeSceneMotion } from '../../src/components/panels/nodes/canvas/rendering/NodeSceneMotion';
import type { CanvasCable, CanvasNode, CanvasScene } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';

const node = { id: 'new', x: 10, y: 20, width: 100, height: 80 } as CanvasNode;
const cable = { id: 'link', from: { x: 110, y: 60 }, to: { x: 220, y: 60 }, color: '#fff', highlighted: false } as CanvasCable;
const scene = (nodes: CanvasNode[], cables: CanvasCable[], graphId = 'graph'): CanvasScene =>
  ({ graphId, nodes, cables, groups: [], plugs: [] });

describe('node scene edit motion', () => {
  it('reveals a compound graph in a wave instead of one visual block', () => {
    const motion = new NodeSceneMotion();
    const nodes = Array.from({ length: 4 }, (_, index) => ({ ...node, id: `node-${index}`, x: index * 100 }));
    const cables = Array.from({ length: 3 }, (_, index) => ({ ...cable, id: `edge-${index}`, from: { x: index * 100, y: 60 } }));
    const full = scene(nodes, cables);
    motion.update(scene([], []), 0);
    motion.update(full, 100);
    const first = motion.frame(full, 110);
    expect(first.nodes[0].appearance).toBeGreaterThan(0);
    expect(first.nodes[3].appearance).toBe(0);
    expect(first.cables[0].appearance).toBeGreaterThan(0);
    expect(first.cables[2].appearance).toBe(0);
    motion.frame(full, 1000);
    expect(motion.active).toBe(false);
  });
  it('animates added and removed graph elements without restarting on scene refresh', () => {
    const motion = new NodeSceneMotion();
    const empty = scene([], []), full = scene([node], [cable]);
    motion.update(empty, 0);
    motion.update(full, 100);
    expect(motion.frame(full, 100).nodes[0].appearance).toBe(0);
    expect(motion.frame(full, 100).cables[0].appearance).toBe(0);
    motion.update(scene([{ ...node, x: 12 }], [{ ...cable, highlighted: true }]), 200);
    const midway = motion.frame(full, 300);
    expect(midway.nodes[0].appearance).toBeGreaterThan(0);
    expect(midway.cables[0].appearance).toBeGreaterThan(0);
    motion.frame(full, 600);
    expect(motion.active).toBe(false);
    motion.update(empty, 700);
    const leaving = motion.frame(empty, 800);
    expect(leaving.nodes[0]).toMatchObject({ id: 'new', disappearing: true });
    expect(leaving.cables[0]).toMatchObject({ id: 'link', disappearing: true });
    motion.frame(empty, 1000);
    expect(motion.active).toBe(false);
  });

  it('does not animate a newly selected graph or after motion is cleared', () => {
    const motion = new NodeSceneMotion();
    motion.update(scene([], []), 0);
    motion.update(scene([node], [cable], 'other'), 100);
    expect(motion.active).toBe(false);
    motion.update(scene([], [], 'other'), 200);
    expect(motion.active).toBe(true);
    motion.clear();
    expect(motion.frame(scene([], [], 'other'), 250).nodes).toEqual([]);
  });
});
