import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../../types/operatorGraph';
import { createJellyfishReferenceGraph } from './jellyfishReferenceGraph';

/**
 * Weave's Qualle form: the ribbon motion of Roman's jellyfish piece "Qualle — Beidseitige Curls"
 * (2026-10-08), taken from its Weave graph without the piece's story layers (metamorphosis, scan
 * overlay, violet marker, particle wake, the 59-second speed envelope). That graph is the Jellyfish
 * reference structure; these are its ribbon values.
 */
export const QUALLE_RIBBON_VALUES: Readonly<Record<string, number>> = {
  'body-length': 1.5, circulation: 0.05, irregularity: 0.04, 'return-motion': 0.4, 'tail-inset': 0.555,
  'curl-detail': 2.65714, 'curl-evolution': 0.08, 'soft-head': 0.15, 'soft-tail': 0.075, 'soft-speed': 0.5, 'return-length': 1.5,
};

/** The three ribbon values the Weave card shows for the Qualle form, keyed by their effect parameter. */
export const QUALLE_CARD_CONTROLS = {
  'pulse-rate_value': { node: 'pulse-rate', label: 'Pulse Rate', value: 0.4, min: 0, max: 2, step: 0.01 },
  'pulse-strength_value': { node: 'pulse-strength', label: 'Pulse Size', value: 0.54, min: 0, max: 0.6, step: 0.01 },
  'curl-strength_value': { node: 'curl-strength', label: 'Curl Strength', value: 0.063, min: 0, max: 0.5, step: 0.001 },
} as const;

/**
 * The piece showed the jellyfish upright in a portrait frame through its clip transform (X turned
 * by −90°). A Weave preset cannot carry a clip transform, so the recipe stands the body up itself:
 * the knitted bell on top, the ribbons hanging down, fitted into a landscape frame.
 */
const POSE = { scale: 0.42, lift: 0.22 };

/** The Qualle recipe graph: the Jellyfish structure with Roman's ribbon values and an upright pose. */
export function createQualleGraph(): EffectOperatorGraph {
  const graph = createJellyfishReferenceGraph();
  const card = new Map<string, { label: string; min: number; max: number; step: number; value: number }>(
    Object.values(QUALLE_CARD_CONTROLS).map(control => [control.node, control]));
  // The shared circulation value and the empty offset of the reference are not part of the piece.
  const dropped = new Set(['circulation', 'offset']);
  graph.nodes = graph.nodes.filter(node => !dropped.has(node.id)).map(node => {
    const control = card.get(node.id);
    if (control) return { ...node, constants: { value: control.value }, exposed: { label: control.label, min: control.min, max: control.max, step: control.step } };
    const knit = node.id === 'knit';
    if (!node.exposed && !knit) return node;
    // Every other value is a fixed part of the piece: no card row, no effect parameter.
    const { exposed: _exposed, ...plain } = node;
    void _exposed;
    return knit ? { ...plain, bindings: {}, constants: { ...plain.constants, speed: QUALLE_RIBBON_VALUES.circulation } }
      : { ...plain, bindings: {}, constants: { value: QUALLE_RIBBON_VALUES[node.id] ?? Number(node.constants?.value ?? 0) } };
  });
  graph.edges = graph.edges.filter(edge => !dropped.has(edge.from) && !dropped.has(edge.to));
  graph.groups = graph.groups?.map(group => ({ ...group, nodeIds: group.nodeIds.filter(id => !dropped.has(id)) }));
  for (const id of dropped) delete graph.layout?.[id];
  return withUprightPose(graph);
}

/** Set Position after the body: (x, y, z) → (x, z, −y) × scale, lifted, so the bell points up. */
function withUprightPose(graph: EffectOperatorGraph): EffectOperatorGraph {
  const layout = graph.layout ?? (graph.layout = {});
  const ids: string[] = [];
  const add = (id: string, operator: string, x: number, y: number, constants?: Record<string, OperatorValue>) => {
    const node: BoundOperatorNode = { id, operator, operatorVersion: 1, bindings: {}, ...(constants ? { constants } : {}) };
    graph.nodes.push(node); layout[id] = { x, y }; ids.push(id);
  };
  const link = (from: string, output: string, to: string, input: string) =>
    graph.edges.push({ id: `${from}-${output}-${to}-${input}`, from, output, to, input });
  const feed = graph.edges.find(edge => edge.to === 'yarn' && edge.input === 'curves');
  if (!feed) throw new Error('Qualle: the jellyfish body has no yarn input.');
  graph.edges = graph.edges.filter(edge => edge !== feed);
  const x = 2380, y = 4300;
  add('pose-position', 'geometry.position', x, y);
  add('pose-split', 'vector.split.vec3', x + 280, y);
  add('pose-scale', 'values.number', x + 280, y + 200, { value: POSE.scale });
  add('pose-flip', 'values.number', x + 280, y + 340, { value: -POSE.scale });
  add('pose-lift', 'values.number', x + 280, y + 480, { value: POSE.lift });
  add('pose-across', 'math.multiply.scalar', x + 560, y - 140);
  add('pose-height', 'math.multiply.scalar', x + 560, y);
  add('pose-up', 'math.add.scalar', x + 840, y);
  add('pose-depth', 'math.multiply.scalar', x + 560, y + 140);
  add('pose-turned', 'vector.combine.vec3', x + 1120, y);
  add('pose', 'geometry.set-position', x + 1400, 80);
  link('pose-position', 'position', 'pose-split', 'value');
  link('pose-split', 'x', 'pose-across', 'a'); link('pose-scale', 'value', 'pose-across', 'b');
  link('pose-split', 'z', 'pose-height', 'a'); link('pose-scale', 'value', 'pose-height', 'b');
  link('pose-height', 'value', 'pose-up', 'a'); link('pose-lift', 'value', 'pose-up', 'b');
  link('pose-split', 'y', 'pose-depth', 'a'); link('pose-flip', 'value', 'pose-depth', 'b');
  link('pose-across', 'value', 'pose-turned', 'x'); link('pose-up', 'value', 'pose-turned', 'y'); link('pose-depth', 'value', 'pose-turned', 'z');
  link(feed.from, feed.output, 'pose', 'curves');
  link('pose-turned', 'value', 'pose', 'position');
  link('pose', 'curves', 'yarn', 'curves');
  // The yarn keeps its thickness relative to the smaller body; its colour is the card's Color.
  for (const node of graph.nodes) {
    if (node.id === 'material') node.bindings = { ...node.bindings, color: 'color' };
    if (node.id === 'yarn') node.constants = { ...node.constants, radius: Number(node.constants?.radius ?? 0.01) * POSE.scale };
    if (node.id === 'flyaways') node.constants = { ...node.constants, length: Number(node.constants?.length ?? 0.055) * POSE.scale };
  }
  graph.groups = [...graph.groups ?? [], { id: 'upright-pose', label: 'Upright Pose', color: '#7d8fa8', nodeIds: ids }];
  return graph;
}
