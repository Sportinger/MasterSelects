import { describe, expect, it } from 'vitest';
import {
  EFFECT_GRAPH_DOC_GROUP, buildEffectGraphDoc, effectGraphDocFoldState, parseEffectGraphDocQuery, slugLabel,
} from '../../src/test/effectGraphDoc/effectGraphDocModel';
import { cableCrossings, wrappedRowCount } from '../../src/test/effectGraphDoc/effectGraphDocLayout';
import { getNodeHeight } from '../../src/components/panels/nodes/canvas/canvasGeometry';

const doc = (search: string) => buildEffectGraphDoc(parseEffectGraphDocQuery(search));
const labels = (search: string) => doc(search).graph.nodes.map(node => node.label);

describe('effect graph doc shots: graph selection', () => {
  it('reads the query with stages as the default level and rejects unknown levels and row counts', () => {
    expect(parseEffectGraphDocQuery('?test=effect-graph&effect=box-blur')).toEqual({ effectType: 'box-blur', level: 'stages', open: [], focus: undefined,
      rows: 'auto', breaks: [], only: [], plumbing: 'show', constants: 'show', omit: [], chain: false });
    expect(parseEffectGraphDocQuery('?effect=zoom-blur&level=all&open=A,b&focus=Stage-B&rows=2&break=sample,reduce&plumbing=hide&constants=hide&omit=output&chain=1'))
      .toEqual({ effectType: 'zoom-blur', level: 'all', open: ['a', 'b'], focus: 'stage-b', rows: 2, breaks: ['sample', 'reduce'], only: [],
        plumbing: 'hide', constants: 'hide', omit: ['output'], chain: true });
    expect(() => parseEffectGraphDocQuery('?constants=dim')).toThrow(/constants/);
    expect(() => parseEffectGraphDocQuery('?only=taper')).toThrow(/focus/);
    expect(() => parseEffectGraphDocQuery('?plumbing=dim')).toThrow(/plumbing/);
    expect(() => parseEffectGraphDocQuery('?level=deep')).toThrow(/Unknown level/);
    expect(() => parseEffectGraphDocQuery('?rows=0')).toThrow(/rows/);
    expect(slugLabel('Coordinates & Resources')).toBe('coordinates-and-resources');
  });

  it('shows the opened effect with folded stage folders, cropped to the effect, and titles parameter values by name', () => {
    const { graph, title, groups } = doc('?effect=gaussian-blur');
    expect(title).toBe('Gaussian Blur');
    expect(graph.nodes.every(node => graph.groups!.find(group => group.id === EFFECT_GRAPH_DOC_GROUP)!.nodeIds.includes(node.id))).toBe(true);
    expect(graph.nodes.some(node => node.binding?.kind === 'clip-source')).toBe(false);
    expect(graph.nodes.map(node => node.label)).toEqual(expect.arrayContaining(['Input Frame', 'Radius & Tap Count', 'Horizontal Pass',
      'Vertical Pass', 'Straight Alpha Output', 'Output', 'Radius']));
    expect(graph.nodes.map(node => node.label)).not.toContain('Value');
    expect(groups.every(group => group.collapsed)).toBe(true);
    // Nested compositions are listed too, so they can be opened by path.
    expect(groups.map(group => group.path)).toEqual(expect.arrayContaining(['horizontal-pass/pair-tap-offsets', 'vertical-pass/merge-pair-weights']));
    expect(graph.edges.every(edge => graph.nodes.some(node => node.id === edge.fromNodeId) && graph.nodes.some(node => node.id === edge.toNodeId))).toBe(true);
    // Docs pictures show structure: no empty preview panes.
    expect(doc('?effect=gaussian-blur').clip.nodeGraph?.previews?.enabled).toBe(false);
  });

  it('opens a nested folder together with the folders around it, and everything at level all', () => {
    const states = effectGraphDocFoldState(parseEffectGraphDocQuery('?effect=gaussian-blur&open=horizontal-pass/pair-tap-offsets'));
    const open = Object.entries(states).filter(([, state]) => !state.collapsed).map(([id]) => id);
    expect(open).toEqual(expect.arrayContaining([EFFECT_GRAPH_DOC_GROUP, `${EFFECT_GRAPH_DOC_GROUP}/organized-gaussian-blur-horizontal`]));
    expect(open.some(id => id.includes('vertical'))).toBe(false);
    expect(labels('?effect=gaussian-blur&open=horizontal-pass/pair-tap-offsets')).toContain('Gaussian Falloff');
    expect(doc('?effect=motion-blur&level=all').groups.every(group => !group.collapsed)).toBe(true);
    expect(labels('?effect=motion-blur&level=all').length).toBeGreaterThan(60);
  });

  it('crops to a focused folder, keeps its flow from inside the effect and wraps it into rows', () => {
    const focused = doc('?effect=box-blur&focus=horizontal-pass');
    expect(focused.title).toBe('Box Blur – Horizontal Pass');
    const names = focused.graph.nodes.map(node => node.label);
    expect(names).toEqual(expect.arrayContaining(['Pair Tap Offsets', 'Merge Pair Weights', 'Sample Image', 'Sequence Reduce', 'Normalize by Weight', 'Clamp']));
    expect(names).not.toContain('Gaussian Falloff');
    expect(names).not.toContain('Vertical Pass');
    const rowsOf = (search: string) => new Set(doc(search).graph.nodes.map(node => Math.round(node.layout.y / 400))).size;
    expect(rowsOf('?effect=box-blur&focus=horizontal-pass&rows=1')).toBeLessThan(rowsOf('?effect=box-blur&focus=horizontal-pass&rows=3'));
    // Within a row, the left-to-right order of the flow is kept.
    const single = doc('?effect=box-blur&focus=horizontal-pass&rows=1').graph.nodes;
    const x = (nodes: typeof single, label: string) => nodes.find(node => node.label === label)!.layout.x;
    expect(x(single, 'Pair Tap Offsets')).toBeLessThan(x(single, 'Merge Pair Weights'));
    expect(x(single, 'Sample Image')).toBeLessThan(x(single, 'Sequence Reduce'));
    expect(Math.max(...single.map(node => node.layout.y + getNodeHeight(node))) - Math.min(...single.map(node => node.layout.y))).toBeLessThan(1200);
  });

  it('names folder ports by what they carry, not by the node type that computes it', () => {
    const { graph } = doc('?effect=gaussian-blur');
    const size = graph.nodes.find(node => node.label === 'Radius & Tap Count')!, pass = graph.nodes.find(node => node.label === 'Vertical Pass')!;
    expect(size.outputs.map(port => port.label)).toEqual(expect.arrayContaining(['Sigma', 'Pairs', 'Stride', 'Tap Count']));
    expect(pass.inputs.map(port => port.label)).toEqual(expect.arrayContaining(['Sigma', 'Stride', 'Horizontal Pass']));
    expect([...size.outputs, ...pass.inputs].some(port => /^(Maximum|Minimum|Add): Value$/.test(port.label))).toBe(false);
    const motion = doc('?effect=radial-blur').graph.nodes.flatMap(node => [...node.inputs, ...node.outputs]).map(port => port.label);
    expect(motion).toEqual(expect.arrayContaining(['Is Spin', 'Box Length', 'Range Length', 'Short Boxes']));
    expect(motion.some(label => /^Switch: Value$/.test(label))).toBe(false);
  });

  it('hides the plumbing folders on request, so the stages read as one path', () => {
    const shown = doc('?effect=motion-blur'), hidden = doc('?effect=motion-blur&plumbing=hide');
    expect(shown.graph.nodes.map(node => node.label)).toEqual(expect.arrayContaining(['Constants', 'Coordinates & Resources']));
    const names = hidden.graph.nodes.map(node => node.label);
    expect(names).not.toContain('Constants'); expect(names).not.toContain('Coordinates & Resources');
    expect(names).toEqual(expect.arrayContaining(['Blur Range', 'Stage A: Short Box (cached)', 'Stage B: Coarse Taps', 'Output']));
    expect(hidden.graph.edges.length).toBeLessThan(shown.graph.edges.length / 2);
    expect(hidden.graph.edges.every(edge => hidden.graph.nodes.some(node => node.id === edge.fromNodeId))).toBe(true);
    // Folder inputs that only constants fed are left out with them.
    const stageB = (graph: typeof shown.graph) => graph.nodes.find(node => node.label === 'Stage B: Coarse Taps')!.inputs.length;
    expect(stageB(hidden.graph)).toBeLessThan(stageB(shown.graph));
  });

  it('gives a focused folder named stubs for values from outside and keeps each stub beside its consumer', () => {
    const { graph } = doc('?effect=gaussian-blur&focus=horizontal-pass&rows=1');
    const stubs = graph.nodes.filter(node => node.id.startsWith('doc-stub:'));
    expect(stubs.map(node => node.label)).toEqual(expect.arrayContaining(['Sigma', 'Pairs', 'Premultiplied Source']));
    // Constants are literal numbers shown on their own cards: no stubs for them.
    expect(stubs.some(node => /^(zero|one|two|half)$/.test(node.label))).toBe(false);
    for (const stub of stubs) {
      const targets = graph.edges.filter(edge => edge.fromNodeId === stub.id).map(edge => graph.nodes.find(node => node.id === edge.toNodeId)!);
      expect(targets.length).toBeGreaterThan(0);
      expect(Math.min(...targets.map(node => node.layout.x))).toBeGreaterThan(stub.layout.x);
    }
    // A row break before Sample Image keeps its source stub on the same row.
    const broken = doc('?effect=gaussian-blur&focus=horizontal-pass&break=horizontal-sample').graph;
    const at = (id: string) => broken.nodes.find(node => node.id.endsWith(`/${id}`))!.layout;
    const source = broken.nodes.find(node => node.label === 'Premultiplied Source')!;
    expect(Math.abs(source.layout.y - at('horizontal-sample').y)).toBeLessThan(200);
    expect(at('horizontal-sample').y).toBeGreaterThan(at('horizontal-offset').y);
  });

  it('shows a picked recipe of a folder compactly, with named stubs and the constants it reads', () => {
    const { graph } = doc('?effect=motion-blur&focus=stage-b-coarse-taps&only=taper-double,taper-centered,taper-squared,taper-exponent,taper,coarse-weight&rows=1');
    const cards = graph.nodes.filter(node => !node.id.startsWith('doc-stub:') && !node.operatorId?.startsWith('values.'));
    expect(cards.map(node => node.id.split('/').at(-1))).toEqual(expect.arrayContaining(['taper-double', 'taper', 'coarse-weight']));
    expect(cards).toHaveLength(6);
    // The literals the math reads are value cards titled by their name: t × 2 − 1, squared, × Taper Gain.
    const constants = graph.nodes.filter(node => node.operatorId?.startsWith('values.')).map(node => node.label);
    expect(constants.toSorted()).toEqual(['One', 'Taper Gain', 'Two']);
    const gain = graph.nodes.find(node => node.label === 'Taper Gain')!;
    expect(graph.edges.some(edge => edge.fromNodeId === gain.id && edge.toNodeId.endsWith('/taper-exponent'))).toBe(true);
    expect(doc('?effect=motion-blur&focus=stage-b-coarse-taps&only=taper-exponent&constants=hide').graph.nodes.some(node => node.label === 'Taper Gain')).toBe(false);
    // The chain reads left to right on one level, and the inputs from outside the pick are named.
    const at = (id: string) => graph.nodes.find(node => node.id.endsWith(`/${id}`))!.layout;
    expect(at('taper-double').x).toBeLessThan(at('taper').x);
    expect(at('taper').x).toBeLessThan(at('coarse-weight').x);
    expect(at('taper-double').y).toBe(at('taper').y);
    const stubs = graph.nodes.filter(node => node.id.startsWith('doc-stub:')).map(node => node.label);
    expect(stubs).toEqual(expect.arrayContaining(['Position t', 'Box Weight']));
    // Box Weight sits under the row beside the last Multiply, not in the path of Exponential's cable.
    const boxWeight = graph.nodes.find(node => node.label === 'Box Weight')!;
    expect(boxWeight.layout.y).toBeGreaterThan(at('taper').y + getNodeHeight(graph.nodes.find(node => node.id.endsWith('/taper'))!));
    expect(cableCrossings(graph.nodes, graph.edges)).toEqual([]);
    expect(graph.overviewTitles).toBe('uniform');
    expect(() => doc('?effect=motion-blur&focus=stage-b-coarse-taps&only=nothing-here')).toThrow(/No node nothing-here/);
  });

  it('lays recipes and overviews out so no cable runs through a card it does not connect', () => {
    for (const search of ['?effect=gaussian-blur&plumbing=hide&omit=output', '?effect=motion-blur&plumbing=hide&omit=output',
      '?effect=gaussian-blur&focus=horizontal-pass&only=compound-shared-zero,horizontal-far-weight,horizontal-near-weight-raw,compound-shared-weight-floor,horizontal-sample,horizontal-reduce,compound-shared-horizontal-weight-vec4,horizontal-cache',
      '?effect=radial-blur&focus=blur-range&only=is-spin,range-length']) {
      const { graph } = doc(search);
      expect(cableCrossings(graph.nodes, graph.edges).map(({ edge, card }) => `${edge.fromNodeId} → ${edge.toNodeId} through ${card.label}`), search).toEqual([]);
    }
    // Stubs that feed one card stack tightly near the canvas' own clearance (56; slots are searched
    // in steps of 8), in the order of its ports.
    const { graph } = doc('?effect=gaussian-blur&focus=horizontal-pass&only=compound-shared-zero');
    const [index, pairs, stride] = ['Tap Index', 'Pairs', 'Stride'].map(label => graph.nodes.find(node => node.label === label)!);
    for (const [upper, lower] of [[index, pairs], [pairs, stride]]) {
      const gap = lower.layout.y - (upper.layout.y + getNodeHeight(upper));
      expect(gap).toBeGreaterThanOrEqual(56);
      expect(gap).toBeLessThan(64);
    }
    expect(() => doc('?effect=gaussian-blur&plumbing=hide&omit=nothing')).toThrow(/No node nothing to omit/);
    expect(doc('?effect=gaussian-blur&plumbing=hide&omit=output').graph.nodes.some(node => node.label === 'Output')).toBe(false);
  });

  it('gives each wrapped row its own height, so a short row leaves no empty band', () => {
    const { graph } = doc('?effect=gaussian-blur&focus=horizontal-pass&break=horizontal-sample');
    const second = graph.nodes.find(node => node.id.endsWith('/horizontal-sample'))!.layout.y;
    const firstRowBottom = Math.max(...graph.nodes.filter(node => node.layout.y < second).map(node => node.layout.y + getNodeHeight(node)));
    expect(second - firstRowBottom).toBeLessThanOrEqual(120);
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
