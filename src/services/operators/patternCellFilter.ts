import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge } from '../../types/operatorGraph';

/**
 * Cell Filter of the two-tone-pattern looks (Halftone, Riso, Riso Glow, Dithering). A cell's tone is read at four
 * points a quarter cell from its centre (HALFTONE_TAPS). Read from the picture itself, four points miss what lies
 * between them, and on moving footage a dot jumps by a quarter of its coverage whenever an edge crosses a point.
 * So the points read a copy of the picture box-averaged over half a cell (`CELL_FILTER_SHARE`): the four boxes
 * together cover the whole cell, the tone is the cell's average light, and it changes smoothly as the picture moves.
 *
 * Two cached passes average rows and then columns of `width` = round(cell × 0.5) whole pixels (at least 1, where
 * the filter is the picture itself), with at most `CELL_FILTER_MAX_TAPS` evenly spread reads per pass. The average
 * is taken in linear light weighted by alpha (premultiplied), so a transparent neighbour never darkens a cell, and
 * stored back as straight sRGB with its average alpha: the taps' own linear-light, alpha-weighted sum then gives the
 * alpha-weighted average of the whole cell.
 */
export const CELL_FILTER_SHARE = .5;
export const CELL_FILTER_MAX_TAPS = 32;
/** Taps that read the cell tone: image samples named `tap-<n>-sample` or `<prefix>-tap-<n>-sample`. */
const TAP_SAMPLE = /(^|-)tap-\d+-sample$/;

export function prefilterCellTaps(graph: EffectOperatorGraph, cellPixels: string, frame = 'frame'): EffectOperatorGraph {
  const taps = graph.nodes.filter(node => node.operator === 'image.sample' && TAP_SAMPLE.test(node.id)
    && graph.edges.some(edge => edge.to === node.id && edge.input === 'image' && edge.from === frame));
  if (!taps.length) throw new Error('Cell filter: no tap reads the frame.');
  if (!graph.nodes.some(node => node.id === cellPixels)) throw new Error(`Cell filter: ${cellPixels} is missing.`);
  if (graph.nodes.some(node => node.id === 'cell-filter')) throw new Error('Cell filter: applied twice.');
  const nodes: BoundOperatorNode[] = [...graph.nodes], edges: OperatorEdge[] = [], layout = { ...graph.layout };
  const base = layout[cellPixels] ?? { x: 0, y: 0 };
  let column = 0;
  const add = (id: string, operator: string, constants?: BoundOperatorNode['constants']) => {
    nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) });
    layout[id] = { x: base.x + 300 * (1 + Math.floor(column / 6)), y: base.y + 240 + 160 * (column % 6) }; column += 1;
    return id;
  };
  const edge = (from: string, output: string, to: string, input: string) => edges.push({ id: `${from}-${to}-${input}`, from, output, to, input });
  const number = (id: string, value: number) => add(id, 'values.number', { value });
  const binary = (id: string, operator: string, a: string, b: string, out = 'value') => { add(id, operator); edge(a, out, id, 'a'); edge(b, 'value', id, 'b'); return id; };

  // The graph's own coordinates and constants where it has them (fewer nodes under the 512-node budget).
  const existing = (operator: string, id?: string) => graph.nodes.find(node => node.operator === operator && (!id || node.id === id))?.id;
  const uv = existing('image.normalized-uv') ?? add('cell-filter-uv', 'image.normalized-uv');
  const resolution = existing('image.resolution') ?? add('cell-filter-resolution', 'image.resolution');
  const resolutionSplit = add('cell-filter-resolution-split', 'vector.split.vec2'); edge(resolution, 'value', resolutionSplit, 'value');
  const uvSplit = add('cell-filter-uv-split', 'vector.split.vec2'); edge(uv, 'uv', uvSplit, 'value');
  const constant = (id: string, value: number) => graph.nodes.find(node => node.id === id && node.operator === 'values.number'
    && !Object.keys(node.bindings).length && node.constants?.value === value)?.id ?? number(`cell-filter-${id}`, value);
  const one = constant('one', 1), half = constant('half', .5), floorAlpha = number('cell-filter-alpha-floor', 1e-6);
  // Width: half a cell in whole pixels, at least one; reads spread evenly over it.
  const shared = binary('cell-filter-raw-width', 'math.multiply.scalar', cellPixels, number('cell-filter-share', CELL_FILTER_SHARE));
  const rounded = add('cell-filter-rounded-width', 'math.floor.scalar'); edge(binary('cell-filter-width-shifted', 'math.add.scalar', shared, half), 'value', rounded, 'value');
  const width = binary('cell-filter-width', 'math.max.scalar', rounded, one);
  const count = binary('cell-filter-taps', 'math.min.scalar', width, number('cell-filter-max-taps', CELL_FILTER_MAX_TAPS));
  const spacing = binary('cell-filter-spacing', 'math.divide-ieee.scalar', width, count);
  const halfWidth = binary('cell-filter-half-width', 'math.multiply.scalar', width, half);
  // The frame clamp the taps use (0.001…0.999).
  let minUv = existing('convert.scalar-to-vec2', 'min-uv'), maxUv = existing('convert.scalar-to-vec2', 'max-uv');
  if (!minUv || !maxUv) {
    minUv = add('cell-filter-min-uv', 'convert.scalar-to-vec2'); edge(number('cell-filter-tiny', .001), 'value', minUv, 'value');
    maxUv = add('cell-filter-max-uv', 'convert.scalar-to-vec2'); edge(number('cell-filter-almost-one', .999), 'value', maxUv, 'value');
  }

  /** One pass along `axis`: the average of `count` reads of `image` across `width` pixels, centred on the pixel. */
  const pass = (prefix: string, axis: 'x' | 'y', image: string, imagePort: string, premultiply: boolean) => {
    const id = (name: string) => `${prefix}-${name}`;
    const index = add(id('index'), 'image.sequence-index');
    const centre = binary(id('tap-centre'), 'math.add.scalar', index, half, 'index');
    const along = binary(id('along'), 'math.subtract.scalar', binary(id('tap-offset'), 'math.multiply.scalar', centre, spacing), halfWidth);
    const step = add(id('step-uv'), 'math.divide-ieee.scalar'); edge(along, 'value', step, 'a'); edge(resolutionSplit, axis, step, 'b');
    const moved = add(id('moved'), 'math.add.scalar'); edge(uvSplit, axis, moved, 'a'); edge(step, 'value', moved, 'b');
    const at = add(id('at'), 'vector.combine.vec2');
    edge(axis === 'x' ? moved : uvSplit, axis === 'x' ? 'value' : 'x', at, 'x'); edge(axis === 'y' ? moved : uvSplit, axis === 'y' ? 'value' : 'y', at, 'y');
    const clamped = add(id('clamped'), 'math.clamp.vec2'); edge(at, 'value', clamped, 'value'); edge(minUv, 'value', clamped, 'min'); edge(maxUv, 'value', clamped, 'max');
    const sample = add(id('sample'), 'image.sample'); edge(image, imagePort, sample, 'image'); edge(clamped, 'value', sample, 'uv');
    let read = sample, readPort = 'image';
    if (premultiply) {
      // Linear light weighted by alpha.
      const split = add(id('split'), 'vector.split.rgba'); edge(sample, 'image', split, 'image');
      const linear = add(id('linear'), 'color.srgb-to-linear.rgb'); edge(split, 'rgb', linear, 'rgb');
      const alpha = add(id('alpha'), 'convert.alpha-to-scalar'); edge(split, 'alpha', alpha, 'alpha');
      const weighted = add(id('weighted'), 'math.multiply.rgb-scalar'); edge(linear, 'rgb', weighted, 'a'); edge(alpha, 'value', weighted, 'b');
      const combined = add(id('premultiplied'), 'vector.combine.rgba'); edge(weighted, 'value', combined, 'rgb'); edge(split, 'alpha', combined, 'alpha');
      read = combined; readPort = 'image';
    }
    const reduce = add(id('reduce'), 'image.sequence-reduce');
    edge(read, readPort, reduce, 'sample'); edge(one, 'value', reduce, 'weight'); edge(count, 'value', reduce, 'count');
    const weight = add(id('weight-vec4'), 'convert.scalar-to-vec4'); edge(reduce, 'weightSum', weight, 'value');
    const average = add(id('average'), 'math.divide-ieee.vec4'); edge(reduce, 'sum', average, 'a'); edge(weight, 'value', average, 'b');
    const result = add(id('image'), 'convert.vec4-to-image'); edge(average, 'value', result, 'value');
    return result;
  };
  const rows = pass('cell-filter-row', 'x', frame, 'image', true);
  const rowCache = add('cell-filter-rows', 'image.materialize', { scale: '1' }); edge(rows, 'image', rowCache, 'image');
  const columns = pass('cell-filter-column', 'y', rowCache, 'image', false);
  // Back to straight sRGB with the average alpha, the form the taps read from the picture.
  const split = add('cell-filter-split', 'vector.split.rgba'); edge(columns, 'image', split, 'image');
  const alpha = add('cell-filter-alpha', 'convert.alpha-to-scalar'); edge(split, 'alpha', alpha, 'alpha');
  const safe = binary('cell-filter-safe-alpha', 'math.max.scalar', alpha, floorAlpha);
  const straight = add('cell-filter-straight', 'math.divide-ieee.rgb-scalar'); edge(split, 'rgb', straight, 'a'); edge(safe, 'value', straight, 'b');
  const encoded = add('cell-filter-srgb', 'color.linear-to-srgb.rgb'); edge(straight, 'value', encoded, 'rgb');
  const packed = add('cell-filter-packed', 'vector.combine.rgba'); edge(encoded, 'rgb', packed, 'rgb'); edge(split, 'alpha', packed, 'alpha');
  const cache = add('cell-filter', 'image.materialize', { scale: '1' }); edge(packed, 'image', cache, 'image');

  const tapIds = new Set(taps.map(node => node.id));
  const rewired = graph.edges.map(item => tapIds.has(item.to) && item.input === 'image' && item.from === frame
    ? { ...item, id: `${cache}-${item.to}-image`, from: cache, output: 'image' } : item);
  return { ...graph, nodes, edges: [...rewired, ...edges], layout };
}
