import type { BoundOperatorNode, EffectOperatorGraph, OperatorDefinition, OperatorParameter, OperatorValue } from '../../../types/operatorGraph';
import {
  FIBER_MATERIAL_PRESET_VALUES,
  FIBER_MATERIAL_PRESETS,
  type FiberMaterialParams,
  type FiberMaterialPreset,
} from '../../../engine/native3d/pathtrace/materials/ptMaterials';
import { STRAND_CURVES_FORMAT } from './curveFormat';

/**
 * Fiber Material (plan 4.10): the look of the fibers of the incoming curves. Shading node, used by
 * Weave today and by hair, grass and cables later. The path tracer reads the values as Chiang
 * hair BSDF parameters, the raster maps them onto its highlight model. Color, roughness and
 * melanin may vary per point through fields; Selection limits the material to some curves, so
 * several Fiber Materials can share one graph (the last selected one wins per point).
 */
export const FIBER_MATERIAL_OPERATOR_ID = 'material.fiber';

const hex = (rgb: readonly number[]) => `#${rgb.map(value => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, '0')).join('')}`;
const number = (id: string, label: string, value: number, min: number, max: number, step: number): OperatorParameter =>
  ({ id, label, type: 'number', default: value, min, max, step, animatable: true });
const wool = FIBER_MATERIAL_PRESET_VALUES.wool;

export const FIBER_MATERIAL_PRESET_LABELS: Record<FiberMaterialPreset | 'custom', string> = {
  wool: 'Wool', cotton: 'Cotton', silk: 'Silk', synthetic: 'Synthetic', hair: 'Hair', custom: 'Custom',
};

/** Material parameter ids and the preset field each one takes. */
const PRESET_FIELDS: ReadonlyArray<[string, (params: FiberMaterialParams) => OperatorValue]> = [
  ['color', params => hex(params.color)], ['absorption', params => params.absorption], ['melanin', params => params.melanin],
  ['melaninRedness', params => params.melaninRedness], ['roughnessLongitudinal', params => params.roughnessLongitudinal],
  ['roughnessAzimuthal', params => params.roughnessAzimuthal], ['cuticleTilt', params => params.cuticleTilt], ['ior', params => params.ior],
  ['coatTint', params => hex(params.coatTint)], ['matte', params => params.matte], ['fuzz', params => params.fuzz],
];
export const FIBER_MATERIAL_VALUE_PARAMETERS = PRESET_FIELDS.map(([id]) => id);

export const FIBER_MATERIAL_OPERATORS: readonly OperatorDefinition[] = [{
  id: FIBER_MATERIAL_OPERATOR_ID, version: 1, label: 'Fiber Material',
  description: 'Gives the incoming curves a physical fiber look (wool, cotton, silk, synthetic, hair): color or melanin absorption, roughness along and across the fiber, cuticle tilt and IOR, a coat tint for the shine, a matte share and fuzz for flyaways. Color, Roughness Scale and Melanin can vary per point; Selection limits it to some curves.',
  inputs: [
    { id: 'curves', label: 'Curves', type: 'curves', required: true, contract: { formats: [STRAND_CURVES_FORMAT] } },
    { id: 'color', label: 'Color Field', type: 'vec3' },
    { id: 'roughness', label: 'Roughness Scale', type: 'number' },
    { id: 'melanin', label: 'Melanin Field', type: 'number' },
    { id: 'selection', label: 'Selection', type: 'number' },
  ],
  outputs: [{ id: 'curves', label: 'Curves', type: 'curves', contract: { formats: [STRAND_CURVES_FORMAT] } }],
  parameters: [
    { id: 'preset', label: 'Preset', type: 'select', default: 'wool', animatable: false,
      options: [...FIBER_MATERIAL_PRESETS, 'custom' as const].map(value => ({ value, label: FIBER_MATERIAL_PRESET_LABELS[value] })) },
    { id: 'color', label: 'Color', type: 'color', default: hex(wool.color), animatable: true },
    { id: 'absorption', label: 'Absorption', type: 'select', default: wool.absorption, animatable: false,
      options: [{ value: 'color', label: 'From Color' }, { value: 'melanin', label: 'Melanin' }] },
    number('melanin', 'Melanin', wool.melanin, 0, 8, 0.01),
    number('melaninRedness', 'Melanin Redness', wool.melaninRedness, 0, 1, 0.01),
    number('roughnessLongitudinal', 'Roughness Along', wool.roughnessLongitudinal, 0.02, 1, 0.01),
    number('roughnessAzimuthal', 'Roughness Across', wool.roughnessAzimuthal, 0.02, 1, 0.01),
    number('cuticleTilt', 'Cuticle Tilt', wool.cuticleTilt, -10, 10, 0.1),
    number('ior', 'IOR', wool.ior, 1.01, 2.5, 0.01),
    { id: 'coatTint', label: 'Coat Tint', type: 'color', default: hex(wool.coatTint), animatable: true },
    number('matte', 'Matte', wool.matte, 0, 1, 0.01),
    number('fuzz', 'Fuzz', wool.fuzz, 0, 1, 0.01),
  ],
  invalidates: 'appearance', runtime: 'builtin', state: 'stateless', addable: true, implementation: 'shared', consumers: ['Weave'],
  bypass: 'passthrough',
}];

/**
 * Applies a preset choice to a Fiber Material node: choosing a preset writes its values into the
 * node, editing a material value afterwards makes the node Custom. Values bound to effect
 * parameters (exposed or keyframed) are left alone. Returns true when the node is a Fiber Material.
 */
export function applyFiberMaterialEdit(node: BoundOperatorNode, name: string, value: OperatorValue): boolean {
  if (node.operator !== FIBER_MATERIAL_OPERATOR_ID) return false;
  const constants: Record<string, OperatorValue> = { ...node.constants };
  if (name === 'preset') {
    constants.preset = value;
    const preset = FIBER_MATERIAL_PRESET_VALUES[value as FiberMaterialPreset];
    if (preset) for (const [id, pick] of PRESET_FIELDS) if (!node.bindings[id]) constants[id] = pick(preset);
  } else {
    constants[name] = value;
    if (FIBER_MATERIAL_VALUE_PARAMETERS.includes(name)) constants.preset = 'custom';
  }
  node.constants = constants;
  return true;
}

/** True when an enabled Fiber Material feeds the curves of Strand Render `renderNodeId`; its Color then comes from the material. */
export function strandRenderHasFiberMaterial(graph: EffectOperatorGraph, renderNodeId: string): boolean {
  const seen = new Set<string>();
  let current = graph.edges.find(edge => edge.to === renderNodeId && edge.input === 'curves')?.from;
  while (current && !seen.has(current)) {
    seen.add(current);
    const node = graph.nodes.find(candidate => candidate.id === current);
    if (!node) return false;
    if (node.operator === FIBER_MATERIAL_OPERATOR_ID && !node.bypassed) return true;
    current = graph.edges.find(edge => edge.to === current && edge.input === 'curves')?.from;
  }
  return false;
}
