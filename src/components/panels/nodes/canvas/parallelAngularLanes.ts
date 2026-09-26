import type { RoutedCable } from './cableBranches';

/** Give crossing cables between the same two cards distinct vertical lanes. */
export function parallelAngularLanes(cables: readonly RoutedCable[]): RoutedCable[] {
  const pairs = new Map<string, RoutedCable[]>();
  for (const cable of cables) {
    if (!cable.fromNode || !cable.toNode || cable.via || cable.to.x - cable.from.x < 24
      || Math.abs(cable.from.y - cable.to.y) < 1) continue;
    const key = `${cable.fromNode}:${cable.toNode}`;
    const pair = pairs.get(key);
    if (pair) pair.push(cable); else pairs.set(key, [cable]);
  }
  const lanes = new Map<string, number>();
  for (const pair of pairs.values()) {
    const ordered = pair.toSorted((a, b) => Math.min(a.from.y, a.to.y) - Math.min(b.from.y, b.to.y));
    let overlapping: RoutedCable[] = [], bottom = -Infinity;
    const assign = () => {
      if (overlapping.length < 2) return;
      const sorted = overlapping.toSorted((a, b) => a.from.y - b.from.y || a.to.y - b.to.y || a.id.localeCompare(b.id));
      const left = Math.max(...sorted.map(cable => cable.from.x)) + 8;
      const right = Math.min(...sorted.map(cable => cable.to.x)) - 8;
      if (right <= left) return;
      const center = (left + right) / 2;
      // Just enough separation to keep each stroke distinct at normal zoom.
      const step = Math.min(3, (right - left) / (sorted.length - 1));
      sorted.forEach((cable, index) => lanes.set(cable.id, center + (index - (sorted.length - 1) / 2) * step));
    };
    for (const cable of ordered) {
      const top = Math.min(cable.from.y, cable.to.y);
      if (top > bottom) { assign(); overlapping = []; bottom = -Infinity; }
      overlapping.push(cable);
      bottom = Math.max(bottom, cable.from.y, cable.to.y);
    }
    assign();
  }
  return cables.map(cable => {
    const laneX = lanes.get(cable.id);
    return laneX === undefined ? cable : { ...cable, laneX,
      via: [{ x: laneX, y: cable.from.y }, { x: laneX, y: cable.to.y }] };
  });
}
