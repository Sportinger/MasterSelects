import { describe, expect, it } from 'vitest';

import {
  resolveLayerHitCycle,
  type LayerHitCycleState,
} from '../../src/components/preview/layerHitCycle';

const layers = [{ id: 'top' }, { id: 'middle' }, { id: 'bottom' }];

function tap(
  previous: LayerHitCycleState | null,
  timestamp: number,
  point = { x: 100, y: 80 },
) {
  return resolveLayerHitCycle({ layers, point, previous, timestamp });
}

describe('resolveLayerHitCycle', () => {
  it('cycles repeated taps through overlapping layers from top to bottom', () => {
    const first = tap(null, 100);
    const second = tap(first.state, 300);
    const third = tap(second.state, 500);
    const fourth = tap(third.state, 700);

    expect([
      first.layer?.id,
      second.layer?.id,
      third.layer?.id,
      fourth.layer?.id,
    ]).toEqual(['top', 'middle', 'bottom', 'top']);
  });

  it('restarts at the top layer after the tap sequence moves or expires', () => {
    const first = tap(null, 100);
    const moved = tap(first.state, 300, { x: 140, y: 80 });
    const expired = tap(moved.state, 2_000, { x: 140, y: 80 });

    expect(moved.layer?.id).toBe('top');
    expect(expired.layer?.id).toBe('top');
  });

  it('restarts when the layers under the tap change', () => {
    const first = tap(null, 100);
    const changed = resolveLayerHitCycle({
      layers: [{ id: 'new-top' }, ...layers],
      point: { x: 100, y: 80 },
      previous: first.state,
      timestamp: 300,
    });

    expect(changed.layer?.id).toBe('new-top');
  });
});
