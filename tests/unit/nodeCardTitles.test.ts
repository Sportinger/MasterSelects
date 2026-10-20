import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { paintBase, overviewTitleBoost } from '../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas';
import type { CanvasNode, CanvasScene, CanvasTheme } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import type { Effect } from '../../src/types/effects';
import { createMockClip } from '../helpers/mockData';

describe('node card titles', () => {
  it('titles value nodes driven by an effect parameter with that parameter, and keeps literals as Value', () => {
    const effect: Effect = { id: 'motion', name: 'Motion Blur', type: 'motion-blur', enabled: true, params: getDefaultParams('motion-blur') };
    const graph = buildEffectOperatorGraph(createMockClip({ id: 'titles', effects: [effect] }), effect);
    const node = (id: string) => graph.nodes.find(candidate => candidate.id === id)!;
    expect(node('amount')).toMatchObject({ label: 'Length', params: { valueLabel: 'Length' } });
    expect(node('angle')).toMatchObject({ label: 'Angle', params: { valueLabel: 'Angle' } });
    expect(node('zero')).toMatchObject({ label: 'Value', params: { valueLabel: 'zero' } });
  });

  it('covers the whole card width under an enlarged overview title, also beside a folded group chevron', () => {
    const fills: number[][] = [];
    const state: Record<string | symbol, unknown> = { canvas: { width: 800, height: 600 } };
    const context = new Proxy(state, {
      get: (target, key) => key in target ? target[key] : key === 'measureText' ? (value: string) => ({ width: String(value).length * 6 })
        : key === 'fillRect' ? (...rect: number[]) => { fills.push(rect); } : () => undefined,
      set: (target, key, value) => { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const node: CanvasNode = { id: 'stage', label: 'Horizontal Pass', description: 'Local node group. Expand to inspect its processing steps.',
      kind: 'effect', runtime: 'subgraph', x: 0, y: 0, width: 180, height: 140, color: '#c9773c', selected: false, bypassed: false,
      bypassable: false, badges: [], ports: [], expandable: true };
    const scene: CanvasScene = { nodes: [node], cables: [], groups: [], plugs: [] };
    const theme: CanvasTheme = { background: '#111', card: '#1b1b1b', text: '#eee', muted: '#888', border: '#333', accent: '#4af' };
    const zoom = 0.3;
    expect(overviewTitleBoost(zoom)).toBeGreaterThan(1);
    paintBase(context, scene, { zoom, panX: 0, panY: 0, width: 800, height: 600, ratio: 1 }, theme);
    // The title band starts below the card header (y 28); the description under it starts at x = 10.
    const bands = fills.filter(([, y, , height]) => y === 28 && height > 20);
    expect(bands).toHaveLength(1);
    expect(bands[0][0]).toBeLessThanOrEqual(1);
    expect(bands[0][0] + bands[0][2]).toBeGreaterThanOrEqual(node.width - 1);
  });
});
