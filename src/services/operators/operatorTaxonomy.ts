import type { OperatorDefinition } from '../../types/operatorGraph';

/**
 * Presentation taxonomy for operator nodes (see docs/ongoing/Node-Taxonomy-Plan.md).
 * Menus are filtered by the owning graph first (image, 3D, splat, audio); these
 * categories are the shared vocabulary inside every graph. IDs never change here.
 */
export const NODE_CATEGORIES = [
  { id: 'inputs', label: 'Inputs' },
  { id: 'values', label: 'Values & Time' },
  { id: 'math', label: 'Math' },
  { id: 'logic', label: 'Logic & Switch' },
  { id: 'vector', label: 'Vector & Convert' },
  { id: 'color', label: 'Color & Mask' },
  { id: 'coordinates', label: 'Coordinates & Lens' },
  { id: 'sampling', label: 'Sampling & Filter' },
  { id: 'time', label: 'Time & Motion' },
  { id: 'patterns', label: 'Patterns & Fields' },
  { id: 'text', label: 'Text & Glyph' },
  { id: 'signal', label: 'Analog Signal' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'splat-transform', label: 'Splat Transform' },
  { id: 'splat-attributes', label: 'Splat Attributes' },
  { id: 'splat-crop', label: 'Crop & Fade' },
  { id: 'shading', label: 'Shading' },
  { id: 'particles', label: 'Particles' },
  { id: 'forces', label: 'Forces & Physics' },
  { id: 'tracking', label: 'Tracking & Depth' },
  { id: 'output', label: 'Output & Render' },
] as const;
export type NodeCategoryId = typeof NODE_CATEGORIES[number]['id'];
export type NodeVisibility = 'public' | 'advanced' | 'internal';

const EXACT: Record<string, NodeCategoryId> = {
  'image.frame': 'inputs', 'image.normalized-uv': 'inputs', 'image.resolution': 'inputs', 'image.named-input': 'inputs',
  'media.source': 'inputs', 'audio.input': 'inputs', 'splat.source': 'inputs', 'geometry.source': 'inputs',
  'image.timeline-time': 'values', 'math.constant': 'values', 'signal.sine-gain.scalar': 'values',
  'convert.degrees-to-radians.scalar': 'math',
  'convert.rgb-to-hsv': 'color', 'convert.hsv-to-rgb': 'color', 'image.mask-overlay': 'color', 'image.luminance': 'color',
  'image.rgb-split': 'vector', 'image.rgb-combine': 'vector',
  'color.sobel-magnitude': 'sampling', 'field.sobel': 'sampling', 'image.sample': 'sampling', 'image.load-pixel-clamped': 'sampling',
  'image.materialize': 'sampling', 'image.resource-input': 'sampling', 'image.segment-sort-luma': 'sampling', 'image.quadtree-partition': 'sampling',
  'image.sample-history': 'time', 'image.frame-history': 'time', 'image.temporal-smooth': 'time', 'image.temporal-smooth.scalar': 'time',
  'image.temporal-history': 'time', 'image.source-motion': 'time', 'image.optical-flow': 'time', 'image.motion-consistency': 'time',
  'image.directional-smooth': 'time', 'field.motion': 'time',
  'color.rgb-stripe-mask': 'patterns', 'geometry.voronoi-seeds': 'patterns', 'geometry.jump-flood': 'patterns',
  'geometry.marching-squares-topology': 'patterns', 'field.read-nearest-seed': 'patterns',
  'data.decode-byte-pixel': 'signal', 'source.memory-window': 'signal',
  'scene.mesh': 'geometry',
  'source.face-landmarks': 'tracking', 'source.saved-depth': 'tracking', 'surface.hybrid': 'tracking',
  'image.output': 'output', 'audio.output': 'output', 'scene.output': 'output', 'scene.render': 'output',
  'scene.transform': 'output', 'scene.clip-transform': 'output',
  'splat.limit': 'splat-transform', 'splat.scale': 'splat-transform', 'splat.rotate': 'splat-transform',
  'splat.color': 'splat-attributes', 'splat.noise': 'splat-attributes', 'splat.select': 'splat-attributes', 'splat.merge': 'splat-attributes',
  'splat.camera-fade': 'splat-crop', 'splat.sphere-crop': 'splat-crop',
  'splat.particles': 'particles', 'splat.particle-system': 'particles', 'splat.gravity': 'forces', 'splat.drag': 'forces', 'splat.turbulence': 'forces',
  'simulation.image-particles': 'particles', 'simulation.particle-release': 'particles', 'simulation.particle-motion': 'particles', 'simulation.rope': 'forces',
  'splat.surface': 'output', 'splat.render': 'output', 'splat.clean-surface': 'output', 'splat.ray-field': 'output', 'splat.mesh-overlay': 'output',
  // Flocking swarm graph.
  'flock.emitter': 'particles', 'flock.merge-spawn': 'particles', 'flock.simulation': 'particles', 'flock.rules': 'particles',
  'flock.cruise': 'particles', 'flock.cluster': 'particles', 'flock.compose': 'particles',
  'flock.attractor': 'forces', 'flock.vortex': 'forces', 'flock.turbulence': 'forces', 'flock.drag': 'forces', 'flock.wind': 'forces',
  'flock.path': 'forces', 'flock.follow-path': 'forces', 'flock.obstacle': 'forces', 'flock.boundary': 'forces',
  'flock.value': 'values', 'flock.oscillator': 'values', 'flock.time': 'values', 'flock.math': 'math', 'flock.remap': 'math',
  'flock.audio': 'inputs', 'flock.palette': 'color', 'flock.trails': 'output', 'flock.output': 'output',
};
const PREFIX: ReadonlyArray<[string, NodeCategoryId]> = [
  ['values.', 'values'], ['math.', 'math'], ['compare.', 'logic'], ['logic.', 'logic'], ['select.', 'logic'], ['control.select.', 'logic'],
  ['vector.', 'vector'], ['convert.', 'vector'], ['color.', 'color'],
  ['coordinates.', 'coordinates'], ['optics.', 'coordinates'], ['fisheye.', 'coordinates'],
  ['sampling.', 'sampling'], ['image.kernel', 'sampling'], ['image.derivative.', 'sampling'],
  ['image.sequence', 'time'], ['feedback.', 'time'], ['motion.', 'time'],
  ['noise.', 'patterns'], ['pattern.', 'patterns'], ['field.', 'patterns'], ['glyph.', 'text'], ['analog.', 'signal'],
  ['geometry.', 'geometry'], ['material.', 'shading'], ['texture.', 'shading'], ['camera.', 'shading'], ['light.', 'shading'],
  ['forces.', 'forces'], ['collision.', 'forces'], ['simulation.', 'particles'],
  ['tracking.', 'tracking'], ['depth.', 'tracking'], ['render.', 'output'],
  ['flock.select-', 'logic'], ['flock.render-', 'output'],
];

/** Explicit category, or undefined for an unmapped operator (a catalog test keeps this exhaustive). */
export function operatorCategoryId(operator: Pick<OperatorDefinition, 'id'>): NodeCategoryId | undefined {
  return EXACT[operator.id] ?? PREFIX.find(([prefix]) => operator.id.startsWith(prefix))?.[1];
}
export function nodeCategoryLabel(id: NodeCategoryId | undefined): string {
  return NODE_CATEGORIES.find(category => category.id === id)?.label ?? 'Other';
}
export const operatorCategoryLabel = (operator: Pick<OperatorDefinition, 'id'>) => nodeCategoryLabel(operatorCategoryId(operator));

/** Building parts of one effect or compiler-near tools: shown only with "Advanced nodes". */
const ADVANCED = new Set([
  'fisheye.aa', 'fisheye.edges', 'fisheye.resolve', 'fisheye.jitter-pattern', 'fisheye.lens-coordinates', 'fisheye.projection-model',
  'fisheye.radius-curve', 'fisheye.edge-coordinates', 'fisheye.edge-coverage', 'fisheye.channel-resolve', 'fisheye.sample-average',
  'sampling.texel-offset', 'sampling.gaussian-weight', 'sampling.normalize-rgba', 'sampling.bounded-count', 'color.sobel-magnitude',
  'color.rgb-stripe-mask', 'signal.sine-gain.scalar', 'feedback.decay-max-rgba', 'glyph.atlas-alpha',
  'coordinates.restore-lens.vec2', 'coordinates.divide-x.vec2', 'image.materialize', 'image.load-pixel-clamped',
  'image.kernel-index', 'image.kernel-grid-reduce', 'image.kernel-rect-reduce',
  'image.sequence-index', 'image.sequence-blend', 'image.sequence-reduce',
  'image.derivative.auto.scalar', 'image.derivative.fine.scalar', 'image.derivative.coarse.scalar',
]);
export function operatorVisibility(operator: Pick<OperatorDefinition, 'id' | 'addable'>): NodeVisibility {
  if (!operator.addable) return 'internal';
  return ADVANCED.has(operator.id) ? 'advanced' : 'public';
}

/**
 * Families shown as one menu entry; the inspector switches the saved variant.
 * Adaptive math/vector families already resolve their variant from wiring.
 */
const MENU_FAMILIES = new Set(['values.numeric', 'control.switch', 'color.luminance', 'geometry.primitive', 'image.derivative', 'image.temporal-smooth', 'vector.reduce-min']);
const FAMILY_REPRESENTATIVE: Record<string, string> = {
  'control.switch': 'select.scalar', 'color.luminance': 'color.luminance-rec709.rgb', 'geometry.primitive': 'geometry.primitive',
  'image.derivative': 'image.derivative.auto.scalar', 'image.temporal-smooth': 'image.temporal-smooth', 'values.numeric': 'values.number',
};
export function menuFamilyKey(operator: Pick<OperatorDefinition, 'id' | 'family' | 'adaptivePorts'>): string {
  return operator.family && (operator.adaptivePorts || MENU_FAMILIES.has(operator.family)) ? operator.family : operator.id;
}

/** One entry per operation family; wiring or the inspector selects the concrete saved variant. */
export function collapseOperatorFamilies<T extends Pick<OperatorDefinition, 'id' | 'family' | 'adaptivePorts' | 'variant'>>(operators: readonly T[]): T[] {
  const families = new Map<string, T>();
  for (const operator of operators) {
    const key = menuFamilyKey(operator), current = families.get(key);
    const preferred = FAMILY_REPRESENTATIVE[key];
    if (!current || (preferred ? operator.id === preferred : operator.variant === 'scalar' && current.variant !== 'scalar')) families.set(key, operator);
  }
  return [...families.values()];
}

const VARIANT_LABELS: Record<string, string> = {
  float: 'Float', integer: 'Integer', scalar: 'Value', rgb: 'RGB', image: 'Image', vec2: 'Vector 2', vec3: 'Vector 3', vec4: 'Vector 4',
  'rec601-rgb': 'Rec.601 (RGB)', 'rec709-rgb': 'Rec.709 (RGB)', 'rec709-image': 'Rec.709 (Image)',
  value: 'Value', 'value-lazy': 'Value (lazy)', vector: 'Vector 2', box: 'Box', sphere: 'Sphere', cylinder: 'Cylinder',
  auto: 'Automatic', fine: 'Fine', coarse: 'Coarse',
};
export function operatorVariantLabel(operator: Pick<OperatorDefinition, 'variant'>): string {
  const variant = operator.variant ?? '';
  return VARIANT_LABELS[variant] ?? variant.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
}
/** Inspector row label for a family's variant choice. */
export function operatorFamilyChoiceLabel(family: string | undefined): string {
  return family === 'values.numeric' ? 'Type' : family === 'geometry.primitive' ? 'Shape' : family === 'color.luminance' ? 'Standard'
    : family === 'control.switch' ? 'Switches' : family === 'image.derivative' ? 'Precision' : family === 'image.temporal-smooth' ? 'Smooths' : 'Components';
}

export interface OperatorMenuGroup<T> { id: NodeCategoryId | 'other'; label: string; entries: T[] }
/** Groups a graph's addable operators by category in catalog order, collapsing families. */
export function groupOperatorMenu<T extends OperatorDefinition>(operators: readonly T[], options: { advanced?: boolean } = {}): OperatorMenuGroup<T>[] {
  const visible = collapseOperatorFamilies(operators.filter(operator => {
    const visibility = operatorVisibility(operator);
    return visibility === 'public' || (options.advanced && visibility === 'advanced');
  }));
  const groups: OperatorMenuGroup<T>[] = NODE_CATEGORIES.map(category => ({ id: category.id, label: category.label, entries: [] as T[] }));
  const other: OperatorMenuGroup<T> = { id: 'other', label: 'Other', entries: [] };
  for (const operator of visible) {
    const id = operatorCategoryId(operator);
    (groups.find(group => group.id === id) ?? other).entries.push(operator);
  }
  for (const group of [...groups, other]) group.entries = group.entries.toSorted((a, b) => a.label.localeCompare(b.label));
  return [...groups, other].filter(group => group.entries.length > 0);
}

const CARD_LABELS: Record<NodeCategoryId, string> = {
  inputs: 'Input', values: 'Value', math: 'Math', logic: 'Logic', vector: 'Vector', color: 'Color', coordinates: 'Coordinates',
  sampling: 'Sampling', time: 'Time', patterns: 'Pattern', text: 'Glyph', signal: 'Analog Signal', geometry: 'Geometry',
  'splat-transform': 'Splat', 'splat-attributes': 'Splat', 'splat-crop': 'Splat', shading: 'Shading', particles: 'Particles', forces: 'Force',
  tracking: 'Tracking', output: 'Output',
};
/** Short type badge for node cards; node groups say so. */
export function operatorCardLabel(operator: Pick<OperatorDefinition, 'id' | 'composition'>): string {
  const category = operatorCategoryId(operator), label = category ? CARD_LABELS[category] : 'Node';
  return operator.composition ? `${label} Group` : label;
}
