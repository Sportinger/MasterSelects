import type { EffectOperatorGraph } from '../../types/operatorGraph';

/**
 * Pattern sizes of the two-tone-pattern looks (cells, dots, grain, registration, edge step) count
 * pixels of a 1080p frame: a size of 14 is 14 pixels on the shorter side of 1080, 28 on a 4K frame
 * and 7 at a half-quality preview of 1080p, so preview, thumbnails and every export size show the
 * same pattern. Drift Lines measures its bands the same way (DRIFT_LINES_REFERENCE_HEIGHT).
 */
export const PATTERN_REFERENCE_HEIGHT = 1080;

export interface ReferenceFrameOptions {
  /** Smallest size in output pixels (1: a cell is never thinner than one pixel); omit for offsets that may stay below a pixel. */
  minimumPixels?: number;
  /** Only these consumers read the measured size (all consumers when omitted). */
  consumers?: readonly string[];
  /** Round to whole output pixels (half to even) before the floor: a dither cell of 1.5 pixels cannot be drawn
   * and beats into a plaid pattern, so it renders 2. */
  wholePixels?: boolean;
}

/**
 * Measures the value of `sizeNode` (a size in 1080p pixels, after its own floor clamp) in output
 * pixels of the frame being rendered: size × shorter side / 1080, at least `minimumPixels`.
 * Rewires the consumers of `sizeNode` to the measured value and returns the graph; the added
 * nodes sit next to `sizeNode` (ids `frame-*` and `<sizeNode>-frame-pixels` / `<sizeNode>-pixels`).
 */
export function measureInReferenceFrame(graph: EffectOperatorGraph, sizeNode: string, options: ReferenceFrameOptions = {}): EffectOperatorGraph {
  const size = graph.nodes.find(node => node.id === sizeNode);
  if (!size) throw new Error(`Reference frame: ${sizeNode} is missing.`);
  if (graph.nodes.some(node => node.id === `${sizeNode}-frame-pixels`)) throw new Error(`Reference frame: ${sizeNode} is measured twice.`);
  const nodes = [...graph.nodes], edges = [...graph.edges], layout = { ...graph.layout };
  const at = layout[sizeNode] ?? { x: 0, y: 0 };
  const add = (id: string, operator: string, dx: number, dy: number, value?: number) => {
    if (!nodes.some(node => node.id === id)) {
      nodes.push({ id, operator, operatorVersion: 1, bindings: {}, ...(value === undefined ? {} : { constants: { value } }) });
      layout[id] = { x: at.x + dx, y: at.y + dy };
    }
    return id;
  };
  const edge = (from: string, to: string, input: string) => edges.push({ id: `${from}-${to}-${input}`, from, output: 'value', to, input });
  // Shared by every size of the graph: the frame scale is computed once.
  let resolution = nodes.find(node => node.operator === 'image.resolution')?.id;
  if (!resolution) resolution = add('frame-resolution', 'image.resolution', -300, 180);
  if (!nodes.some(node => node.id === 'frame-scale')) {
    add('frame-short-side', 'vector.reduce-min.vec2', -300, 360); edge(resolution, 'frame-short-side', 'value');
    add('frame-reference-height', 'values.number', -300, 540, PATTERN_REFERENCE_HEIGHT);
    add('frame-scale', 'math.divide-ieee.scalar', 0, 540);
    edge('frame-short-side', 'frame-scale', 'a'); edge('frame-reference-height', 'frame-scale', 'b');
  }
  const measured = add(`${sizeNode}-frame-pixels`, 'math.multiply.scalar', 300, 180);
  let result = measured;
  if (options.wholePixels) { result = add(`${sizeNode}-whole-pixels`, 'math.round-even.scalar', 450, 180); edge(measured, result, 'value'); }
  if (options.minimumPixels !== undefined) {
    const minimum = add(`${sizeNode}-minimum-pixels`, 'values.number', 300, 360, options.minimumPixels);
    const rounded = result;
    result = add(`${sizeNode}-pixels`, 'math.max.scalar', 600, 180);
    edge(rounded, result, 'a'); edge(minimum, result, 'b');
  }
  // Consumers first, so the size's own edge into the multiply is not rewired.
  const reads = (item: { from: string; to: string }) => item.from === sizeNode && (!options.consumers || options.consumers.includes(item.to));
  const output = edges.find(reads)?.output;
  if (!output) throw new Error(`Reference frame: nothing reads ${sizeNode}.`);
  const rewired = edges.map(item => reads(item) ? { ...item, id: `${result}-${item.to}-${item.input}`, from: result, output: 'value' } : item);
  rewired.push({ id: `${sizeNode}-${measured}-a`, from: sizeNode, output, to: measured, input: 'a' });
  rewired.push({ id: `frame-scale-${measured}-b`, from: 'frame-scale', output: 'value', to: measured, input: 'b' });
  return { ...graph, nodes, edges: rewired, layout };
}
