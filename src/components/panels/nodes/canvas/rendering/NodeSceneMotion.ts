import type { CanvasCable, CanvasNode, CanvasPlug, CanvasScene, Point } from './nodeCanvasTypes';
import { buildUpStagger, NODE_ENTER_MS } from './buildUpTiming';

const NODE_EXIT_MS = 210;
const CABLE_ENTER_MS = 430;
const CABLE_EXIT_MS = 190;
const MAX_ENTRY_STAGGER_MS = 1400;

interface Motion<T> { item: T; start: number; exit: boolean }
/** One eased move per item; each point pair is interpolated together. */
interface Glide { from: Point[]; to: Point[]; start: number; duration: number }

const easeOut = (value: number) => 1 - (1 - value) ** 3;
const progress = (now: number, motion: { start: number }, duration: number) =>
  Math.min(1, Math.max(0, (now - motion.start) / duration));
const same = (a: Point[], b: Point[]) => a.every((point, index) => point.x === b[index].x && point.y === b[index].y);
const glidePoints = (glide: Glide, now: number) => {
  const t = easeOut(progress(now, glide, glide.duration));
  return glide.from.map((from, index) => ({ x: from.x + (glide.to[index].x - from.x) * t, y: from.y + (glide.to[index].y - from.y) * t }));
};

/** Tracks structural edits only. Scene updates for hover, dragging and playback do not restart motion. */
export class NodeSceneMotion {
  private previous?: CanvasScene;
  private nodes = new Map<string, Motion<CanvasNode>>();
  private cables = new Map<string, Motion<CanvasCable>>();
  // Layout transitions: main sends each fold step once, the worker eases every
  // frame in between, so large graphs move without per-frame main-thread work.
  private glides = { nodes: new Map<string, Glide>(), cables: new Map<string, Glide>(), plugs: new Map<string, Glide>() };

  private retarget(glides: Map<string, Glide>, id: string, shown: Point[], target: Point[], now: number, duration: number) {
    const active = glides.get(id);
    const from = active ? glidePoints(active, now) : shown;
    if (same(from, target)) glides.delete(id);
    else glides.set(id, { from, to: target, start: now, duration });
  }

  update(scene: CanvasScene, now: number) {
    const before = this.previous;
    this.previous = scene;
    if (!before || before.graphId !== scene.graphId) { this.clear(); return; }
    if (scene.glideMs) {
      const duration = scene.glideMs;
      const nodes = new Map(before.nodes.map(node => [node.id, node]));
      for (const node of scene.nodes) {
        const old = nodes.get(node.id);
        if (old) this.retarget(this.glides.nodes, node.id, [old], [node], now, duration);
      }
      const cables = new Map(before.cables.filter(cable => cable.id).map(cable => [cable.id!, cable]));
      for (const cable of scene.cables) {
        const old = cable.id ? cables.get(cable.id) : undefined;
        if (old) this.retarget(this.glides.cables, cable.id!, [old.from, old.to], [cable.from, cable.to], now, duration);
      }
      const plugs = new Map(before.plugs.filter(plug => plug.id).map(plug => [plug.id!, plug]));
      for (const plug of scene.plugs) {
        const old = plug.id ? plugs.get(plug.id) : undefined;
        if (old) this.retarget(this.glides.plugs, plug.id!, [old.center, old.tip], [plug.center, plug.tip], now, duration);
      }
    } else for (const glides of Object.values(this.glides)) glides.clear();
    const oldNodes = new Map(before.nodes.map(node => [node.id, node]));
    const newNodes = new Set(scene.nodes.map(node => node.id));
    const addedNodes = scene.nodes.filter(node => !oldNodes.has(node.id)).toSorted((a, b) => a.x - b.x || a.y - b.y);
    // Layout build-ups use the sequencer's timing so the next group waits for this wave.
    const nodeStep = scene.glideMs ? buildUpStagger(addedNodes.length)
      : addedNodes.length > 1 ? Math.min(35, MAX_ENTRY_STAGGER_MS / (addedNodes.length - 1)) : 0;
    addedNodes.forEach((node, index) => this.nodes.set(node.id, { item: node, start: now + index * nodeStep, exit: false }));
    for (const node of before.nodes) if (!newNodes.has(node.id)) this.nodes.set(node.id, { item: node, start: now, exit: true });
    const oldCables = new Map(before.cables.filter(cable => cable.id).map(cable => [cable.id!, cable]));
    const newCables = new Set(scene.cables.map(cable => cable.id));
    const addedCables = scene.cables.filter(cable => cable.id && !oldCables.has(cable.id))
      .toSorted((a, b) => a.from.x - b.from.x || a.from.y - b.from.y);
    const cableStep = addedCables.length > 1 ? Math.min(35, MAX_ENTRY_STAGGER_MS / (addedCables.length - 1)) : 0;
    // A cable draws in after the later of its two nodes has started to appear.
    const nodeStart = (id?: string) => (id ? this.nodes.get(id) : undefined)?.start ?? now;
    addedCables.forEach((cable, index) => this.cables.set(cable.id!, {
      item: cable, exit: false,
      start: cable.fromNode || cable.toNode ? Math.max(nodeStart(cable.fromNode), nodeStart(cable.toNode)) + NODE_ENTER_MS * 0.5 : now + index * cableStep,
    }));
    for (const cable of before.cables) if (cable.id && !newCables.has(cable.id)) this.cables.set(cable.id, { item: cable, start: now, exit: true });
  }

  clear() { this.nodes.clear(); this.cables.clear(); for (const glides of Object.values(this.glides)) glides.clear(); }
  get active() {
    return this.nodes.size > 0 || this.cables.size > 0
      || this.glides.nodes.size > 0 || this.glides.cables.size > 0 || this.glides.plugs.size > 0;
  }

  private glide<T>(items: T[], glides: Map<string, Glide>, now: number, id: (item: T) => string | undefined, apply: (item: T, points: Point[]) => T): T[] {
    if (!glides.size) return items;
    for (const [key, glide] of glides) if (now - glide.start >= glide.duration) glides.delete(key);
    return items.map(item => {
      const key = id(item), glide = key !== undefined ? glides.get(key) : undefined;
      return glide ? apply(item, glidePoints(glide, now)) : item;
    });
  }

  frame(scene: CanvasScene, now: number): CanvasScene {
    for (const [id, motion] of this.nodes) if (progress(now, motion, motion.exit ? NODE_EXIT_MS : NODE_ENTER_MS) >= 1) this.nodes.delete(id);
    for (const [id, motion] of this.cables) if (progress(now, motion, motion.exit ? CABLE_EXIT_MS : CABLE_ENTER_MS) >= 1) this.cables.delete(id);
    scene = { ...scene,
      nodes: this.glide(scene.nodes, this.glides.nodes, now, node => node.id, (node, [point]) => ({ ...node, x: point.x, y: point.y })),
      cables: this.glide(scene.cables, this.glides.cables, now, cable => cable.id, (cable, [from, to]) => ({ ...cable, from, to })),
      plugs: this.glide(scene.plugs, this.glides.plugs, now, plug => plug.id, (plug: CanvasPlug, [center, tip]) => ({ ...plug, center, tip })) };
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
