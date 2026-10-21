import { describe, expect, it } from 'vitest';
import { getDefaultParams } from '../../src/effects';
import { buildEffectOperatorGraph } from '../../src/services/nodeGraph/effectGraphProjection';
import { paintBase, overviewTitleBoost } from '../../src/components/panels/nodes/canvas/rendering/paintNodeCanvas';
import type { CanvasNode, CanvasScene, CanvasTheme } from '../../src/components/panels/nodes/canvas/rendering/nodeCanvasTypes';
import type { Effect } from '../../src/types/effects';
import { createMockClip, createMockTrack } from '../helpers/mockData';
import { buildClipNodeGraphDocument } from '../../src/services/nodeGraph/clipGraphDocument';
import { buildUnifiedClipGraph } from '../../src/services/nodeGraph/unifiedClipGraph';

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

  it('gives every zoomed-out title one size in a uniform-title scene, so short names do not outshout long ones', () => {
    const fonts: Array<{ text: string; size: number }> = [];
    const state: Record<string | symbol, unknown> = { canvas: { width: 800, height: 600 } };
    const context = new Proxy(state, {
      get: (target, key) => key in target ? target[key] : key === 'measureText'
        ? (value: string) => ({ width: String(value).length * 0.6 * Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1] ?? 10) })
        : key === 'fillText' ? (value: string) => { fonts.push({ text: value, size: Number(/(\d+(?:\.\d+)?)px/.exec(String(target.font))?.[1]) }); }
          : () => undefined,
      set: (target, key, value) => { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const card = (id: string, label: string, x: number): CanvasNode => ({ id, label, description: '', kind: 'math', runtime: 'builtin', x, y: 0,
      width: 180, height: 140, color: '#c9773c', selected: false, bypassed: false, bypassable: false, badges: [], ports: [] });
    const theme: CanvasTheme = { background: '#111', card: '#1b1b1b', text: '#eee', muted: '#888', border: '#333', accent: '#4af' };
    const titleSizes = (uniformTitles: boolean) => {
      fonts.length = 0;
      const scene: CanvasScene = { nodes: [card('a', 'Pairs', 0), card('b', 'Normalize by Weight', 240)], cables: [], groups: [], plugs: [], uniformTitles };
      paintBase(context, scene, { zoom: 0.3, panX: 0, panY: 0, width: 800, height: 600, ratio: 1 }, theme);
      const size = (title: string) => Math.max(...fonts.filter(entry => title.includes(entry.text) && entry.size > 13).map(entry => entry.size));
      return [size('Pairs'), size('Normalize by Weight')];
    };
    const [shortFit, longFit] = titleSizes(false);
    expect(shortFit).toBeGreaterThan(longFit);
    const [shortUniform, longUniform] = titleSizes(true);
    expect(shortUniform).toBe(longUniform);
    expect(longUniform).toBe(longFit);
  });
  it('paints the › of a folded card after its overview title, so it shows without hovering', () => {
    const strokes: Array<Array<[string, number, number]>> = [];
    let path: Array<[string, number, number]> = [];
    const order: string[] = [];
    const state: Record<string | symbol, unknown> = { canvas: { width: 800, height: 600 } };
    const context = new Proxy(state, {
      get: (target, key) => key in target ? target[key] : key === 'measureText' ? (value: string) => ({ width: String(value).length * 6 })
        : key === 'beginPath' ? () => { path = []; } : key === 'moveTo' || key === 'lineTo' ? (x: number, y: number) => { path.push([key, x, y]); }
          : key === 'stroke' ? () => { strokes.push(path); order.push('stroke'); } : key === 'fillRect' ? () => { order.push('fill'); } : () => undefined,
      set: (target, key, value) => { target[key] = value; return true; },
    }) as unknown as CanvasRenderingContext2D;
    const node: CanvasNode = { id: 'stage', label: 'Horizontal Pass', description: '', kind: 'effect', runtime: 'subgraph', x: 0, y: 0, width: 180,
      height: 140, color: '#c9773c', selected: false, bypassed: false, bypassable: false, badges: [], ports: [], expandable: true };
    const theme: CanvasTheme = { background: '#111', card: '#1b1b1b', text: '#eee', muted: '#888', border: '#333', accent: '#4af' };
    paintBase(context, { nodes: [node], cables: [], groups: [], plugs: [] }, { zoom: 0.3, panX: 0, panY: 0, width: 800, height: 600, ratio: 1 }, theme);
    const chevron = strokes.findIndex(points => points.length === 3 && points[0][0] === 'moveTo' && points[1][1] > points[0][1] && points[2][1] === points[0][1]);
    expect(chevron).toBeGreaterThanOrEqual(0);
    // Drawn after the last fill (the title band), inside the 30-unit slot left of the title.
    expect(order.lastIndexOf('stroke')).toBeGreaterThan(order.lastIndexOf('fill'));
    expect(Math.max(...strokes[chevron].map(([, x]) => x))).toBeLessThan(30);
  });
  it('titles an effect added by type id with its registered name on its card and folder', () => {
    const effect: Effect = { id: 'fx', name: 'gaussian-blur', type: 'gaussian-blur', enabled: true, params: getDefaultParams('gaussian-blur') };
    const clip = createMockClip({ id: 'named', trackId: 'v', effects: [effect] });
    const track = createMockTrack({ id: 'v' });
    const document = buildClipNodeGraphDocument(clip, track);
    expect(document.graphs.flatMap(graph => graph.nodes).find(node => node.id === 'effect-fx')?.label).toBe('Gaussian Blur');
    const unified = buildUnifiedClipGraph(document, clip, [clip], [], undefined, false);
    expect(unified.groups?.find(group => group.effectId === 'fx')?.label).toBe('Gaussian Blur');
    // A renamed effect keeps its own name.
    const renamed = { ...clip, effects: [{ ...effect, name: 'Soft background' }] };
    expect(buildUnifiedClipGraph(buildClipNodeGraphDocument(renamed, track), renamed, [renamed], [], undefined, false)
      .groups?.find(group => group.effectId === 'fx')?.label).toBe('Soft background');
  });
});
