import { withSlitScanRgbTime } from './slitScanRgbTimeGraph';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorEdge, OperatorGroup } from '../../types/operatorGraph';
import { withSlitScanProtection } from './slitScanProtectionGraph';
import { withSlitScanTimeMap } from './slitScanTimeMapGraph';
import { withSlitScanMotion } from './slitScanMotionGraph';

type Ref = { node: string; port: string };

/** All spatial shaping uses shared operators. Only temporal sampling is new. */
export function createDefaultSlitScanGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [], edges: OperatorEdge[] = [], groups: OperatorGroup[] = [];
  const layout: EffectOperatorGraph['layout'] = {};
  let group: OperatorGroup;
  const section = (id: string, label: string, color: string) => {
    group = { id, label, color, nodeIds: [] }; groups.push(group);
  };
  const node = (id: string, operator: string, inputs: Record<string, Ref> = {}, port = 'value',
    bindings: Record<string, string> = {}, constants?: BoundOperatorNode['constants']): Ref => {
    nodes.push({ id, operator, operatorVersion: 1, bindings, ...(constants ? { constants } : {}) });
    layout[id] = { x: (groups.length - 1) * 1200 + (group.nodeIds.length % 4) * 280, y: Math.floor(group.nodeIds.length / 4) * 180 };
    group.nodeIds.push(id);
    for (const [input, from] of Object.entries(inputs)) edges.push({ id: `${id}:${input}`, from: from.node, output: from.port, to: id, input });
    return { node: id, port: operator.startsWith('compare.') ? 'condition' : port };
  };
  const n = (id: string, value: number) => node(id, 'values.number', {}, 'value', {}, { value });
  const bound = (id: string) => node(id, 'values.number', {}, 'value', { value: id });
  const unary = (id: string, op: string, value: Ref) => node(id, op, { value });
  const binary = (id: string, op: string, a: Ref, b: Ref) => node(id, op, { a, b });
  const add = (id: string, a: Ref, b: Ref) => binary(id, 'math.add.scalar', a, b);
  const mul = (id: string, a: Ref, b: Ref) => binary(id, 'math.multiply.scalar', a, b);
  const select = (id: string, condition: Ref, falseValue: Ref, trueValue: Ref) => node(id, 'select.scalar', { condition, falseValue, trueValue });
  section('scan-source', 'Source & Controls', '#64748b');
  const frame = node('frame', 'image.frame', {}, 'image'), uv = node('uv', 'image.normalized-uv', {}, 'uv');
  const time = node('time', 'image.timeline-time'), resolution = node('resolution', 'image.resolution');
  const zero = n('zero', 0), one = n('one', 1), half = n('half', 0.5), two = n('two', 2);
  const delay = bound('delay'), angle = bound('angle'), mix = bound('mix');
  const bands = bound('bands');
  const centerX = bound('centerX'), centerY = bound('centerY'), protect = bound('protect'), feather = bound('feather');
  const waves = bound('waves'), phase = bound('phase'), speed = bound('speed');
  const profile = node('profile', 'values.choice', {}, 'value', { value: 'profile' });
  const clamp = (id: string, value: Ref) => node(id, 'math.clamp.scalar', { value, min: zero, max: one });

  section('scan-axis', 'Scan Direction', '#0ea5e9');
  const center = node('center', 'vector.combine.vec2', { x: centerX, y: centerY });
  const centered = binary('centered-uv', 'math.subtract.vec2', uv, center);
  const radians = mul('radians', angle, n('degrees-to-radians', Math.PI / 180));
  const cosine = unary('cosine', 'math.cos.scalar', radians), sine = unary('sine', 'math.sin.scalar', radians);
  const axis = node('axis', 'vector.combine.vec2', { x: cosine, y: sine });
  const span = add('axis-span', unary('abs-cos', 'math.abs.scalar', cosine), unary('abs-sin', 'math.abs.scalar', sine));
  const projected = binary('projected', 'vector.dot.vec2', centered, axis);
  const coordinate = binary('coordinate', 'math.divide-ieee.scalar', projected, span);
  const linear = clamp('linear', add('linear-offset', coordinate, half));
  const radial = clamp('out-from-center', mul('center-distance', unary('abs-coordinate', 'math.abs.scalar', coordinate), two));

  section('scan-wave', 'Wave & Profile', '#8b5cf6');
  const cycles = add('cycles', add('wave-position', mul('wave-frequency', coordinate, waves), phase), mul('wave-time', time, speed));
  const wave = add('wave', half, mul('wave-amplitude', half, unary('wave-sine', 'math.sin.scalar', mul('wave-radians', cycles, n('tau', Math.PI * 2)))));
  const isCenter = binary('is-center', 'compare.greater.scalar', profile, half);
  const isWave = binary('is-wave', 'compare.greater.scalar', profile, n('wave-threshold', 1.5));
  const offset = select('profile-offset', isWave, select('linear-or-center', isCenter, linear, radial), wave);

  section('scan-protection', 'Protected Center', '#f59e0b');
  const size = node('size', 'vector.split.vec2', { value: resolution }, 'x');
  const aspect = binary('aspect', 'math.divide-ieee.scalar', size, { node: size.node, port: 'y' });
  const scale = node('aspect-scale', 'vector.combine.vec2', { x: aspect, y: one });
  const distance = unary('radius-distance', 'vector.length.vec2', binary('aspect-uv', 'math.multiply.vec2', centered, scale));
  const smooth = node('feather-mask', 'math.smoothstep.scalar', { value: distance, edge0: protect, edge1: add('feather-edge', protect, feather) });
  const hasProtection = binary('has-protection', 'compare.greater.scalar', protect, zero);
  const mask = select('protection-mask', hasProtection, one, smooth);
  const radius = mul('radial-distance', distance, two);
  const ringCycles = add('ring-cycles', add('ring-position', mul('ring-frequency', radius, waves), phase), mul('ring-time', time, speed));
  const rings = add('rings', half, mul('ring-amplitude', half, unary('ring-sine', 'math.sin.scalar', mul('ring-radians', ringCycles, n('ring-tau', Math.PI * 2)))));
  const isRadial = binary('is-radial', 'compare.greater.scalar', profile, n('radial-threshold', 2.5));
  const isRings = binary('is-rings', 'compare.greater.scalar', profile, n('rings-threshold', 3.5));
  const spatialOffset = select('spatial-profile', isRadial, offset, select('radial-profile', isRings, clamp('radial-scan', radius), rings));

  section('scan-history', 'Time Sampling & Mix', '#10b981');
  const count = binary('band-count', 'math.max.scalar', unary('integer-bands', 'math.floor.scalar', bands), two);
  const bandPosition = binary('band-position', 'math.min.scalar', spatialOffset, n('band-upper-edge', 0.999999));
  const bandIndex = unary('band-index', 'math.floor.scalar', mul('band-grid', bandPosition, count));
  const stepped = binary('stepped-time', 'math.divide-ieee.scalar', bandIndex, binary('band-divisor', 'math.subtract.scalar', count, one));
  const quantized = select('smooth-or-banded', binary('use-bands', 'compare.greater.scalar', bands, one), spatialOffset, stepped);
  const safeDelay = node('safe-delay', 'math.clamp.scalar', { value: delay, min: zero, max: n('max-delay', 60) });
  const seconds = mul('sample-delay', mul('masked-delay', quantized, mask), safeDelay);
  const sample = node('history', 'image.sample-history', { uv, delay: seconds, current: frame }, 'image');
  const original = node('original-rgba', 'convert.image-to-vec4', { image: frame });
  const delayed = node('delayed-rgba', 'convert.image-to-vec4', { image: sample });
  const mixed = node('mix-rgba', 'math.mix.vec4', { a: original, b: delayed, t: clamp('safe-mix', mix) });
  const image = node('result', 'convert.vec4-to-image', { value: mixed }, 'image');
  node('output', 'image.output', { image });
  return withSlitScanRgbTime(withSlitScanMotion(withSlitScanTimeMap(withSlitScanProtection({ version: 1, schemaVersion: 1, domain: 'image', nodes, edges, groups, layout }))));
}
