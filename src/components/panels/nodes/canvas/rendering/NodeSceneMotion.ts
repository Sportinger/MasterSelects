import type { CanvasCable, CanvasNode, CanvasScene } from './nodeCanvasTypes';

const NODE_ENTER_MS = 330;
const NODE_EXIT_MS = 210;
const CABLE_ENTER_MS = 430;
const CABLE_EXIT_MS = 190;
const MAX_ENTRY_STAGGER_MS = 1400;

interface Motion<T> { item: T; start: number; exit: boolean }

const easeOut = (value: number) => 1 - (1 - value) ** 3;
const progress = (now: number, motion: Motion<unknown>, duration: number) =>
  Math.min(1, Math.max(0, (now - motion.start) / duration));

/** Tracks structural edits only. Scene updates for hover, dragging and playback do not restart motion. */
export class NodeSceneMotion {
  private previous?: CanvasScene;
  private nodes = new Map<string, Motion<CanvasNode>>();
  private cables = new Map<string, Motion<CanvasCable>>();

  update(scene: CanvasScene, now: number) {
    const before = this.previous;
    this.previous = scene;
    if (!before || before.graphId !== scene.graphId) { this.clear(); return; }
    const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
    const newNodes = new Set(scene.nodes.map(node => node.id));
    const addedNodes = scene.nodes.filter(node => !oldNodes.has(node.id)).toSorted((a, b) => a.x - b.x || a.y - b.y);
    const nodeStep = addedNodes.length > 1 ? Math.min(35, MAX_ENTRY_STAGGER_MS / (addedNodes.length - 1)) : 0;
    addedNodes.forEach((node, index) => this.nodes.set(node.id, { item: node, start: now + index * nodeStep, exit: false }));
    for (const node of before.nodes) if (!newNodes.has(node.id)) this.nodes.set(node.id, { item: node, start: now, exit: true });
    const oldCables = new Map(before.cables.filter(cable => cable.id).map(cable => [cable.id!, cable]));
    const newCables = new Set(scene.cables.map(cable => cable.id));
    const addedCables = scene.cables.filter(cable => cable.id && !oldCables.has(cable.id))
      .toSorted((a, b) => a.from.x - b.from.x || a.from.y - b.from.y);
    const cableStep = addedCables.length > 1 ? Math.min(35, MAX_ENTRY_STAGGER_MS / (addedCables.length - 1)) : 0;
    addedCables.forEach((cable, index) => this.cables.set(cable.id!, {
      item: cable, start: now + index * cableStep, exit: false,
    }));
    for (const cable of before.cables) if (cable.id && !newCables.has(cable.id)) this.cables.set(cable.id, { item: cable, start: now, exit: true });
  }

  clear() { this.nodes.clear(); this.cables.clear(); }
  get active() { return this.nodes.size > 0 || this.cables.size > 0; }

  frame(scene: CanvasScene, now: number): CanvasScene {
    for (const [id, motion] of this.nodes) if (progress(now, motion, motion.exit ? NODE_EXIT_MS : NODE_ENTER_MS) >= 1) this.nodes.delete(id);
    for (const [id, motion] of this.cables) if (progress(now, motion, motion.exit ? CABLE_EXIT_MS : CABLE_ENTER_MS) >= 1) this.cables.delete(id);
    const nodes = scene.nodes.map(node => {
      const motion = this.nodes.get(node.id);
      if (!motion || motion.exit) return node;
      const amount = progress(now, motion, NODE_ENTER_MS);
      return { ...node, appearance: easeOut(amount) };
    });
    const cables = scene.cables.map(cable => {
      const motion = cable.id && this.cables.get(cable.id);
      if (!motion || motion.exit) return cable;
      const amount = progress(now, motion, CABLE_ENTER_MS);
      return { ...cable, appearance: easeOut(amount) };
    });
    for (const motion of this.nodes.values()) if (motion.exit) {
      const amount = progress(now, motion, NODE_EXIT_MS);
      nodes.push({ ...motion.item, appearance: easeOut(1 - amount), disappearing: true });
    }
    for (const motion of this.cables.values()) if (motion.exit) {
      const amount = progress(now, motion, CABLE_EXIT_MS);
      cables.push({ ...motion.item, appearance: 1 - easeOut(amount), disappearing: true });
    }
    return { ...scene, nodes, cables };
  }
}
