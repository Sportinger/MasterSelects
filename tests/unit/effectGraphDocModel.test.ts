import { describe, expect, it } from 'vitest';
import {
  EFFECT_GRAPH_DOC_GROUP, buildEffectGraphDoc, effectGraphDocFoldState, parseEffectGraphDocQuery, slugLabel,
} from '../../src/test/effectGraphDoc/effectGraphDocModel';
import { wrappedRowCount } from '../../src/test/effectGraphDoc/effectGraphDocLayout';
import { getNodeHeight } from '../../src/components/panels/nodes/canvas/canvasGeometry';

const doc = (search: string) => buildEffectGraphDoc(parseEffectGraphDocQuery(search));
const labels = (search: string) => doc(search).graph.nodes.map(node => node.label);

describe('effect graph doc shots: graph selection', () => {
  it('reads the query with stages as the default level and rejects unknown levels and row counts', () => {
    expect(parseEffectGraphDocQuery('?test=effect-graph&effect=box-blur')).toEqual({ effectType: 'box-blur', level: 'stages', open: [], focus: undefined, rows: 'auto', chain: false });
    expect(parseEffectGraphDocQuery('?effect=zoom-blur&level=all&open=A,b&focus=Stage-B&rows=2&chain=1'))
      .toEqual({ effectType: 'zoom-blur', level: 'all', open: ['a', 'b'], focus: 'stage-b', rows: 2, chain: true });
    expect(() => parseEffectGraphDocQuery('?level=deep')).toThrow(/Unknown level/);
    expect(() => parseEffectGraphDocQuery('?rows=0')).toThrow(/rows/);
    expect(slugLabel('Coordinates & Resources')).toBe('coordinates-and-resources');
  });

  it('shows the opened effect with folded stage folders, cropped to the effect, and titles parameter values by name', () => {
    const { graph, title, groups } = doc('?effect=gaussian-blur');
    expect(title).toBe('Gaussian Blur');
    expect(graph.nodes.every(node => graph.groups!.find(group => group.id === EFFECT_GRAPH_DOC_GROUP)!.nodeIds.includes(node.id))).toBe(true);
    expect(graph.nodes.some(node => node.binding?.kind === 'clip-source')).toBe(false);
    expect(graph.nodes.map(node => node.label)).toEqual(expect.arrayContaining(['Input Frame', 'Radius & Tap Count', 'Horizontal Pass (premultiplied)',
      'Vertical Pass', 'Straight Alpha Output', 'Output', 'Radius']));
    expect(graph.nodes.map(node => node.label)).not.toContain('Value');
    expect(groups.every(group => group.collapsed)).toBe(true);
    // Nested compositions are listed too, so they can be opened by path.
    expect(groups.map(group => group.path)).toEqual(expect.arrayContaining(['horizontal-pass-premultiplied/pair-tap-offsets', 'vertical-pass/merge-pair-weights']));
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.fromNodeId) && graph.nodes.some(node => node.id === edge.toNodeId))).toBe(true);
    // Docs pictures show structure: no empty preview panes.
    expect(doc('?effect=gaussian-blur').clip.nodeGraph?.previews?.enabled).toBe(false);
  });

  it('opens a nested folder together with the folders around it, and everything at level all', () => {
    const states = effectGraphDocFoldState(parseEffectGraphDocQuery('?effect=gaussian-blur&open=horizontal-pass-premultiplied/pair-tap-offsets'));
    const open = Object.entries(states).filter(([, state]) => !state.collapsed).map(([id]) => id);
    expect(open).toEqual(expect.arrayContaining([EFFECT_GRAPH_DOC_GROUP, `${EFFECT_GRAPH_DOC_GROUP}/organized-gaussian-blur-horizontal`]));
    expect(open.some(id => id.includes('vertical'))).toBe(false);
    expect(labels('?effect=gaussian-blur&open=horizontal-pass-premultiplied/pair-tap-offsets')).toContain('Gaussian Falloff');
    expect(doc('?effect=motion-blur&level=all').groups.every(group => !group.collapsed)).toBe(true);
    expect(labels('?effect=motion-blur&level=all').length).toBeGreaterThan(60);
  });

  it('crops to a focused folder, keeps its flow from inside the effect and wraps it into rows', () => {
    const focused = doc('?effect=box-blur&focus=horizontal-pass-premultiplied');
    expect(focused.title).toBe('Box Blur – Horizontal Pass (premultiplied)');
    const names = focused.graph.nodes.map(node => node.label);
    expect(names).toEqual(expect.arrayContaining(['Pair Tap Offsets', 'Merge Pair Weights', 'Sample Image', 'Sequence Reduce', 'Normalize by Weight', 'Clamp']));
    expect(names).not.toContain('Gaussian Falloff');
    expect(names).not.toContain('Vertical Pass');
    const rowsOf = (search: string) => new Set(doc(search).graph.nodes.map(node => Math.round(node.layout.y / 400))).size;
    expect(rowsOf('?effect=box-blur&focus=horizontal-pass-premultiplied&rows=1')).toBeLessThan(rowsOf('?effect=box-blur&focus=horizontal-pass-premultiplied&rows=3'));
    // Within a row, the left-to-right order of the flow is kept.
    const single = doc('?effect=box-blur&focus=horizontal-pass-premultiplied&rows=1').graph.nodes;
    const x = (nodes: typeof single, label: string) => nodes.find(node => node.label === label)!.layout.x;
    expect(x(single, 'Pair Tap Offsets')).toBeLessThan(x(single, 'Merge Pair Weights'));
    expect(x(single, 'Sample Image')).toBeLessThan(x(single, 'Sequence Reduce'));
    expect(Math.max(...single.map(node => node.layout.y + getNodeHeight(node))) - Math.min(...single.map(node => node.layout.y))).toBeLessThan(1200);
  });

  it('names the available folders when a token matches none, and rejects effects without a graph', () => {
    expect(() => doc('?effect=gaussian-blur&focus=nowhere')).toThrow(/No folder "nowhere".*vertical-pass/);
    expect(() => doc('?effect=not-an-effect')).toThrow(/Unknown effect/);
  });

  it('wraps long chains into a landscape picture', () => {
    expect(wrappedRowCount(6000, 600, 18)).toBeGreaterThan(1);
    expect(wrappedRowCount(1600, 1000, 6)).toBe(1);
  });
});
