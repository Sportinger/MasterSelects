import type { CanvasCable, CanvasPlug, CanvasScene, CanvasView, Rect } from './nodeCanvasTypes';

const CELL_SIZE = 512;
const MAX_ITEM_CELLS = 64;
const MAX_QUERY_CELLS = 4096;

function validRect(rect: Rect): boolean {
  return Number.isFinite(rect.x) && Number.isFinite(rect.y) && Number.isFinite(rect.width) && Number.isFinite(rect.height)
    && rect.width >= 0 && rect.height >= 0;
}

function cableBounds(cable: CanvasCable): Rect {
  const h = Math.max(72, Math.abs(cable.to.x - cable.from.x) * .42);
  const left = Math.min(cable.from.x, cable.to.x - h);
  const right = Math.max(cable.from.x + h, cable.to.x);
  return { x: left, y: Math.min(cable.from.y, cable.to.y), width: right - left, height: Math.abs(cable.to.y - cable.from.y) };
}

function plugBounds(plug: CanvasPlug): Rect {
  return { x: Math.min(plug.tip.x, plug.center.x) - 8, y: plug.center.y - 8,
    width: Math.abs(plug.tip.x - plug.center.x) + 16, height: 16 };
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x + a.width >= b.x && a.x <= b.x + b.width && a.y + a.height >= b.y && a.y <= b.y + b.height;
}

class RectIndex<T> {
  private readonly items: readonly T[];
  private readonly bounds: readonly Rect[];
  private readonly cells = new Map<string, number[]>();
  private readonly broad: number[] = [];
  private readonly valid: number[] = [];

  constructor(items: readonly T[], bounds: (item: T) => Rect) {
    this.items = items;
    this.bounds = items.map(bounds);
    this.bounds.forEach((rect, index) => {
      if (!validRect(rect)) return;
      this.valid.push(index);
      const left = Math.floor(rect.x / CELL_SIZE), right = Math.floor((rect.x + rect.width) / CELL_SIZE);
      const top = Math.floor(rect.y / CELL_SIZE), bottom = Math.floor((rect.y + rect.height) / CELL_SIZE);
      if ((right - left + 1) * (bottom - top + 1) > MAX_ITEM_CELLS) { this.broad.push(index); return; }
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        const key = `${x}:${y}`, cell = this.cells.get(key);
        if (cell) cell.push(index); else this.cells.set(key, [index]);
      }
    });
  }

  query(view: Rect): T[] {
    if (!validRect(view)) return [];
    const candidates = new Set(this.broad);
    const left = Math.floor(view.x / CELL_SIZE), right = Math.floor((view.x + view.width) / CELL_SIZE);
    const top = Math.floor(view.y / CELL_SIZE), bottom = Math.floor((view.y + view.height) / CELL_SIZE);
    const columns = right - left + 1, rows = bottom - top + 1;
    if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows) || columns * rows > MAX_QUERY_CELLS) {
      for (const index of this.valid) candidates.add(index);
    } else {
      for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) {
        for (const index of this.cells.get(`${x}:${y}`) ?? []) candidates.add(index);
      }
    }
    return [...candidates].toSorted((a, b) => a - b).filter(index => intersects(this.bounds[index], view)).map(index => this.items[index]);
  }
}

/** Scene-local spatial index: pan/zoom work scales with visible items, not the full graph. */
export class CanvasSceneVisibility {
  private readonly nodes: RectIndex<CanvasScene['nodes'][number]>;
  private readonly cables: RectIndex<CanvasCable>;
  private readonly groups: RectIndex<CanvasScene['groups'][number]>;
  private readonly plugs: RectIndex<CanvasPlug>;

  constructor(scene: CanvasScene) {
    this.nodes = new RectIndex(scene.nodes, node => node);
    this.cables = new RectIndex(scene.cables, cableBounds);
    this.groups = new RectIndex(scene.groups, group => group);
    this.plugs = new RectIndex(scene.plugs, plugBounds);
  }

  visible(view: CanvasView, margin = 30): CanvasScene {
    if (!Number.isFinite(view.zoom) || view.zoom <= 0 || !Number.isFinite(view.panX) || !Number.isFinite(view.panY)
      || !Number.isFinite(view.width) || view.width < 0 || !Number.isFinite(view.height) || view.height < 0
      || !Number.isFinite(margin) || margin < 0) return { nodes: [], cables: [], groups: [], plugs: [] };
    const zoom = view.zoom;
    const rect = { x: (-view.panX - margin) / zoom, y: (-view.panY - margin) / zoom,
      width: (view.width + margin * 2) / zoom, height: (view.height + margin * 2) / zoom };
    return { nodes: this.nodes.query(rect), cables: this.cables.query(rect), groups: this.groups.query(rect), plugs: this.plugs.query(rect) };
  }
}
