import { describe, expect, it } from 'vitest';
import { routeAroundCards, type AvoidPoint, type AvoidRect } from '../../src/components/panels/nodes/canvas/cableAvoidance';
import { cableRoute, sampleCableRoute } from '../../src/components/panels/nodes/canvas/cableRoute';

const hits = (points: AvoidPoint[], rect: AvoidRect) => points.some((point, index) => {
  if (!index) return false;
  const a = points[index - 1], b = point;
  const left = Math.min(a.x, b.x), right = Math.max(a.x, b.x), top = Math.min(a.y, b.y), bottom = Math.max(a.y, b.y);
  return left < rect.x + rect.width && right > rect.x && top < rect.y + rect.height && bottom > rect.y;
});

describe('cable obstacle avoidance', () => {
  it('does not exempt an unrelated group just because a source port is close to its frame', () => {
    const frame = { groupId: 'effect', nodeIds: ['inside'], x: 250, y: -200, width: 500, height: 500 };
    const from = { x: 180, y: 0 }, to = { x: 1000, y: 0 };
    const via = routeAroundCards([frame], [{ id: 'e', from, to, fromNode: 'source', toNode: 'output' }]).get('e');
    expect(via).toBeDefined();
    expect(hits(sampleCableRoute(cableRoute(from, to, 'curved', via)), frame)).toBe(false);
  });
  it.each([false, true])('avoids whole expanded frames, including rounded and backward links (backward: %s)', backward => {
    const frame = { groupId: 'effect', x: 350, y: -1000, width: 350, height: 2000 };
    const from = { x: backward ? 1000 : 100, y: 0 }, to = { x: backward ? 100 : 1000, y: 150 };
    const via = routeAroundCards([frame], [{ id: 'e', from, to }]).get('e');
    expect(via).toBeDefined();
    for (const style of ['angular', 'curved', 'smart'] as const)
      expect(hits(sampleCableRoute(cableRoute(from, to, style, via)), frame)).toBe(false);
  });

  it('allows connections within endpoint groups while avoiding unrelated nested frames', () => {
    const parent = { groupId: 'parent', x: -100, y: -300, width: 1300, height: 700 };
    const child = { groupId: 'sibling', x: 400, y: -80, width: 200, height: 250 };
    const from = { x: 100, y: 0 }, to = { x: 1000, y: 0 };
    const via = routeAroundCards([parent, child], [{ id: 'e', from, to }]).get('e');
    expect(via).toBeDefined();
    expect(hits([from, ...via!, to], child)).toBe(false);
  });
  it('routes around a card that sits on the direct lane, with orthogonal legs and port-height ends', () => {
    const blocker = { x: 400, y: -60, width: 184, height: 160 };
    const from = { x: 200, y: 20 }, to = { x: 900, y: 20 };
    const route = routeAroundCards([blocker], [{ id: 'e', from, to }]).get('e')!;
    expect(route).toBeDefined();
    expect(hits([from, ...route, to], blocker)).toBe(false);
    expect(route[0]).toEqual({ x: from.x + 36, y: from.y });
    expect(route.at(-1)).toEqual({ x: to.x - 36, y: to.y });
    for (let index = 1; index < route.length; index++) {
      const a = route[index - 1], b = route[index];
      expect(a.x === b.x || a.y === b.y).toBe(true);
    }
  });

  it('leaves clear and backward links alone', () => {
    const routes = routeAroundCards([], [{ id: 'clear', from: { x: 0, y: 0 }, to: { x: 800, y: 0 } },
      { id: 'back', from: { x: 800, y: 0 }, to: { x: 0, y: 100 } }]);
    expect(routes.has('clear')).toBe(false);
    expect(routes.has('back')).toBe(false);
  });

  it('routes a large column layout within an interactive budget', () => {
    const cards: AvoidRect[] = [];
    for (let column = 0; column < 25; column++) for (let row = 0; row < 20; row++) cards.push({ x: column * 400, y: row * 260, width: 184, height: 180 });
    const cables = Array.from({ length: 700 }, (_, index) => {
      const a = cards[(index * 7) % cards.length], b = cards[(index * 13 + 60) % cards.length];
      const [left, right] = a.x < b.x ? [a, b] : [b, a];
      return { id: `c${index}`, source: `s${index % 90}`, from: { x: left.x + 184 + 24, y: left.y + 60 }, to: { x: right.x - 24, y: right.y + 90 } };
    });
    const started = performance.now();
    const routes = routeAroundCards(cards, cables);
    const elapsed = performance.now() - started;
    expect(routes.size).toBeGreaterThan(300);
    for (const cable of cables) {
      const route = routes.get(cable.id);
      if (route) expect(cards.some(card => hits([cable.from, ...route, cable.to], { x: card.x + 2, y: card.y + 2, width: card.width - 4, height: card.height - 4 }))).toBe(false);
    }
    console.info(`routed ${routes.size}/${cables.length} cables in ${Math.round(elapsed)} ms`);
    expect(elapsed).toBeLessThan(1500);
  });
});
