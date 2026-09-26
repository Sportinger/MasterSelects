/** Obstacle-avoiding cable routes: orthogonal waypoints around node cards. */

export interface AvoidPoint { x: number; y: number }
export interface AvoidRect { x: number; y: number; width: number; height: number; groupId?: string; nodeIds?: string[] }
export interface AvoidCable { id: string; from: AvoidPoint; to: AvoidPoint; source?: string; fromNode?: string; toNode?: string; laneX?: number }

/** Graph units per routing cell. */
const CELL = 24;
/** Clearance kept around cards, in graph units. */
const MARGIN = 14;
const GROUP_MARGIN = 28;
/** Horizontal run out of an output and into an input before a route may turn. */
const STUB = 36;
/** Cells searched beyond the box spanned by both endpoints. */
const WINDOW = 24;
/** Search budget per cable; beyond it the cable keeps its direct route. */
const MAX_EXPANSIONS = 120_000;
const TURN_COST = 4;
/** Cells already used by a cable of the same output are cheaper, which bundles them. */
const SHARED_COST = 0.45;
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1]] as const;
/** Weighted A*: a slightly greedier search finds near-optimal lanes in a fraction of the steps. */
const GREED = 1.6;
/** Numeric cell key; graphs span far less than 2^20 cells per axis. */
const cellKey = (x: number, y: number) => (x + 0x80000) * 0x100000 + (y + 0x80000);

class MinHeap {
  private keys: number[] = []; private values: number[] = [];
  get size() { return this.keys.length; }
  push(key: number, value: number) {
    const keys = this.keys, values = this.values;
    let index = keys.length; keys.push(key); values.push(value);
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (keys[parent] <= key) break;
      keys[index] = keys[parent]; values[index] = values[parent]; index = parent;
    }
    keys[index] = key; values[index] = value;
  }
  pop(): number {
    const keys = this.keys, values = this.values, top = values[0];
    const key = keys.pop()!, value = values.pop()!;
    if (keys.length) {
      let index = 0;
      for (;;) {
        const left = index * 2 + 1, right = left + 1;
        let smallest = index, smallestKey = key;
        if (left < keys.length && keys[left] < smallestKey) { smallest = left; smallestKey = keys[left]; }
        if (right < keys.length && keys[right] < smallestKey) smallest = right;
        if (smallest === index) break;
        keys[index] = keys[smallest]; values[index] = values[smallest]; index = smallest;
      }
      keys[index] = key; values[index] = value;
    }
    return top;
  }
}

/** Blocked-cell lookup over card rectangles, bucketed and memoized per routing pass. */
function obstacleGrid(obstacles: readonly AvoidRect[]) {
  const BUCKET = 16; // cells per bucket side
  const buckets = new Map<string, AvoidRect[]>();
  for (const rect of obstacles) {
    const margin = rect.groupId ? GROUP_MARGIN : MARGIN;
    const left = Math.floor((rect.x - margin) / CELL / BUCKET), right = Math.floor((rect.x + rect.width + margin) / CELL / BUCKET);
    const top = Math.floor((rect.y - margin) / CELL / BUCKET), bottom = Math.floor((rect.y + rect.height + margin) / CELL / BUCKET);
    for (let bx = left; bx <= right; bx++) for (let by = top; by <= bottom; by++) {
      const key = `${bx}:${by}`, list = buckets.get(key);
      if (list) list.push(rect); else buckets.set(key, [rect]);
    }
  }
  const memo = new Map<number, boolean>();
  return (cx: number, cy: number) => {
    const key = cellKey(cx, cy), known = memo.get(key);
    if (known !== undefined) return known;
    const x = (cx + 0.5) * CELL, y = (cy + 0.5) * CELL;
    const blocked = (buckets.get(`${Math.floor(cx / BUCKET)}:${Math.floor(cy / BUCKET)}`) ?? []).some(rect => {
      const margin = rect.groupId ? GROUP_MARGIN : MARGIN;
      return x >= rect.x - margin && x <= rect.x + rect.width + margin && y >= rect.y - margin && y <= rect.y + rect.height + margin;
    });
    memo.set(key, blocked);
    return blocked;
  };
}

/** Orthogonal A* with a turn penalty between two cells; returns cells or null. */
function search(start: [number, number], goal: [number, number], blocked: (x: number, y: number) => boolean,
  shared: ReadonlySet<number> | undefined, groups: readonly AvoidRect[] = []): Array<[number, number]> | null {
  const left = Math.min(start[0], goal[0], ...groups.map(rect => Math.floor(rect.x / CELL))) - WINDOW;
  const top = Math.min(start[1], goal[1], ...groups.map(rect => Math.floor(rect.y / CELL))) - WINDOW;
  const width = Math.max(start[0], goal[0], ...groups.map(rect => Math.ceil((rect.x + rect.width) / CELL))) + WINDOW - left + 1;
  const height = Math.max(start[1], goal[1], ...groups.map(rect => Math.ceil((rect.y + rect.height) / CELL))) + WINDOW - top + 1;
  // Sparse bookkeeping: memory follows the explored corridor, not the window area.
  const cost = new Map<number, number>(), parent = new Map<number, number>();
  const index = (x: number, y: number, direction: number) => ((y - top) * width + (x - left)) * 4 + direction;
  const heap = new MinHeap();
  // Leave the output heading right.
  const first = index(start[0], start[1], 0);
  cost.set(first, 0); heap.push(GREED * (Math.abs(goal[0] - start[0]) + Math.abs(goal[1] - start[1])), first);
  let expansions = 0;
  const closed = new Set<number>();
  while (heap.size && expansions < MAX_EXPANSIONS) {
    const state = heap.pop();
    if (closed.has(state)) continue;
    closed.add(state); expansions++;
    const direction = state & 3, cell = state >> 2;
    const x = left + (cell % width), y = top + Math.floor(cell / width);
    // The final port stub already enters horizontally. A vertical arrival here
    // is a valid corner, and must not force an extra lap around the goal cell.
    if (x === goal[0] && y === goal[1] && direction !== 2) {
      const cells: Array<[number, number]> = [];
      for (let at: number | undefined = state; at !== undefined; at = parent.get(at)) { const c = at >> 2; cells.push([left + (c % width), top + Math.floor(c / width)]); }
      return cells.reverse();
    }
    const base = cost.get(state)!;
    for (let next = 0; next < 4; next++) {
      if (next === (direction + 2) % 4) continue; // no U-turn in place
      const nx = x + DIRECTIONS[next][0], ny = y + DIRECTIONS[next][1];
      if (nx < left || ny < top || nx >= left + width || ny >= top + height) continue;
      if (!(nx === goal[0] && ny === goal[1]) && blocked(nx, ny)) continue;
      const step = (shared?.has(cellKey(nx, ny)) ? SHARED_COST : 1) + (next === direction ? 0 : TURN_COST);
      const target = index(nx, ny, next), total = base + step;
      if (total >= (cost.get(target) ?? Infinity)) continue;
      cost.set(target, total); parent.set(target, state);
      heap.push(total + GREED * (Math.abs(goal[0] - nx) + Math.abs(goal[1] - ny)) + (nx === goal[0] && ny === goal[1] && next !== 0 ? TURN_COST : 0), target);
    }
  }
  return null;
}

/** Corner points only, snapped so the first and last runs stay on the port heights. */
function waypoints(cells: Array<[number, number]>, from: AvoidPoint, to: AvoidPoint, startStub = STUB, endStub = STUB): AvoidPoint[] {
  const corners: Array<[number, number]> = [cells[0]];
  for (let index = 1; index < cells.length - 1; index++) {
    const [a, b, c] = [cells[index - 1], cells[index], cells[index + 1]];
    if ((b[0] - a[0]) !== (c[0] - b[0]) || (b[1] - a[1]) !== (c[1] - b[1])) corners.push(b);
  }
  corners.push(cells.at(-1)!);
  const startRow = cells[0][1], goalRow = cells.at(-1)![1];
  const points = corners.map(([cx, cy]) => ({ x: (cx + 0.5) * CELL, y: cy === startRow ? from.y : cy === goalRow ? to.y : (cy + 0.5) * CELL }));
  points[0] = { x: from.x + startStub, y: from.y };
  points[points.length - 1] = { x: to.x - endStub, y: to.y };
  // Snapping can leave a vertical leg slanted by less than a cell; square it up.
  for (let index = 1; index < points.length - 1; index++) {
    const previous = points[index - 1], point = points[index];
    if (Math.abs(point.x - previous.x) < CELL && Math.abs(point.y - previous.y) >= CELL) point.x = previous.x;
  }
  return points;
}

/** Prefer a clear port-to-port lane before grid snapping or shared lanes can
 * introduce a dogleg. Check full segments against the real clearance rectangles. */
function directLane(from: AvoidPoint, to: AvoidPoint, obstacles: readonly AvoidRect[], preferredX?: number): AvoidPoint[] | undefined {
  const clear = (a: AvoidPoint, b: AvoidPoint) => !obstacles.some(rect => {
    const margin = rect.groupId ? GROUP_MARGIN : MARGIN;
    return Math.max(a.x, b.x) > rect.x - margin && Math.min(a.x, b.x) < rect.x + rect.width + margin
      && Math.max(a.y, b.y) > rect.y - margin && Math.min(a.y, b.y) < rect.y + rect.height + margin;
  });
  const candidates: AvoidPoint[][] = [];
  if (to.x > from.x) {
    // Shrink the horizontal stubs to the available gap; never overshoot an input.
    const stub = Math.min(STUB, (to.x - from.x) / 2);
    for (const x of [preferredX, (from.x + to.x) / 2, to.x - stub, from.x + stub]) {
      if (x === undefined || x <= from.x || x >= to.x) continue;
      candidates.push([{ x, y: from.y }, { x, y: to.y }]);
    }
  } else if (from.y !== to.y) {
    // A backward link needs a return lane, but not a drop below both ports when
    // the vertical space between them is already clear of cards.
    const y = (from.y + to.y) / 2;
    candidates.push([{ x: from.x + STUB, y: from.y }, { x: from.x + STUB, y },
      { x: to.x - STUB, y }, { x: to.x - STUB, y: to.y }]);
  }
  for (const via of candidates) {
    const points = [from, ...via, to];
    if (points.slice(1).every((point, index) => clear(points[index], point))) return via;
  }
  return undefined;
}

/** Waypoints (between the ports, excluding them) for every cable that found a clear path. */
export function routeAroundCards(obstacles: readonly AvoidRect[], cables: readonly AvoidCable[]): Map<string, AvoidPoint[]> {
  const cards = obstacles.filter(rect => !rect.groupId), groups = obstacles.filter(rect => rect.groupId);
  const cardBlocked = obstacleGrid(cards), routes = new Map<string, AvoidPoint[]>();
  const grids = new Map<string, ReturnType<typeof obstacleGrid>>();
  const used = new Map<string, Set<number>>();
  const cell = (x: number, y: number): [number, number] => [Math.floor(x / CELL), Math.floor(y / CELL)];
  // Short cables first: they have fewest choices and anchor the bundles.
  for (const cable of [...cables].toSorted((a, b) => Math.abs(a.to.x - a.from.x) - Math.abs(b.to.x - b.from.x))) {
    // Endpoint groups must remain accessible; all other expanded frames are solid.
    const contains = (rect: AvoidRect, point: AvoidPoint, nodeId?: string) => nodeId && rect.nodeIds
      ? rect.nodeIds.includes(nodeId)
      : point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
    const blockingGroups = groups.filter(rect => !contains(rect, cable.from, cable.fromNode) && !contains(rect, cable.to, cable.toNode));
    const direct = directLane(cable.from, cable.to, [...cards, ...blockingGroups], cable.laneX);
    if (direct) { routes.set(cable.id, direct); continue; }
    const key = JSON.stringify(blockingGroups.map(rect => rect.groupId));
    let groupBlocked = grids.get(key);
    if (!groupBlocked) { groupBlocked = obstacleGrid(blockingGroups); grids.set(key, groupBlocked); }
    const blocked = (x: number, y: number) => cardBlocked(x, y) || groupBlocked(x, y);
    // A nearby frame can require an earlier turn than the usual port stub.
    const startStub = [STUB, 24, 12].find(stub => !blocked(...cell(cable.from.x + stub, cable.from.y)));
    const endStub = [STUB, 24, 12].find(stub => !blocked(...cell(cable.to.x - stub, cable.to.y)));
    if (startStub === undefined || endStub === undefined) continue;
    const start = cell(cable.from.x + startStub, cable.from.y), goal = cell(cable.to.x - endStub, cable.to.y);
    const shared = cable.source ? used.get(cable.source) : undefined;
    const nearbyGroups = blockingGroups.filter(rect => rect.x <= Math.max(cable.from.x, cable.to.x) + WINDOW * CELL
      && rect.x + rect.width >= Math.min(cable.from.x, cable.to.x) - WINDOW * CELL
      && rect.y <= Math.max(cable.from.y, cable.to.y) + WINDOW * CELL && rect.y + rect.height >= Math.min(cable.from.y, cable.to.y) - WINDOW * CELL);
    const path = search(start, goal, blocked, shared, nearbyGroups);
    if (!path || path.length < 2) continue;
    const points = waypoints(path, cable.from, cable.to, startStub, endStub);
    // A route that only bends where the direct lane would is not worth replacing.
    if (points.length <= 2 && Math.abs(cable.from.y - cable.to.y) < 1) continue;
    routes.set(cable.id, points);
    if (cable.source) {
      const set = used.get(cable.source) ?? new Set<number>();
      for (const [x, y] of path) set.add(cellKey(x, y));
      used.set(cable.source, set);
    }
  }
  return routes;
}
