import { voxelTextureMapping } from './voxelTextureMapping';
import type { BoundOperatorNode, EffectOperatorGraph, OperatorValue } from '../../types/operatorGraph';
import { EFFECT_GRAPH_PARAM, operatorEnabled, readEffectGraph, validateEffectGraph } from './effectGraph';
import { getEffectOperator } from './operatorRegistry';
import { isVoxelOperator } from './voxelOperators';
import { createDefaultVoxelGraph } from './voxelGraphDefaults';
export { createDefaultVoxelGraph } from './voxelGraphDefaults';
import { compileScalarField, type ScalarFieldProgram } from './scalarField';
import { scalarFieldBounds } from './scalarFieldBounds';
import { VOXEL_RELIEF_PARAMS } from '../../effects/stylize/voxel-relief/parameters';
import { expandVoxelGeometry } from './expandVoxelGeometry';

type Params = Record<string, unknown>;
type UV = [number, number, number, number];
export interface VoxelGraphPlan {
  visible: boolean;
  heightUV: UV;
  colorUV: UV;
  textured: boolean;
  tint: [number, number, number];
  opacity: number;
  boxSize: [number, number, number];
  maxHeight: number;
  field: ScalarFieldProgram;
  params: Record<string, number | boolean | string>;
}

export function voxelOperatorGraph(params: Params): EffectOperatorGraph {
  const graph = readEffectGraph(params[EFFECT_GRAPH_PARAM], createDefaultVoxelGraph);
  const errors = validateVoxelGraph(graph);
  if (errors.length) throw new Error(errors[0]);
  return expandVoxelGeometry(graph);
}

export function validateVoxelGraph(graph: EffectOperatorGraph): string[] {
  const errors = validateEffectGraph(graph);
  if (graph.domain !== 'voxel' || graph.nodes.some(node => !isVoxelOperator(node.operator))) errors.push('Unsupported Voxel Relief operator graph.');
  return errors;
}

/** Compiles the connected output into the existing raymarch/native render path.
 * Flat legacy parameters and keyframe property IDs retain their ownership. */
export function compileVoxelGraph(params: Params): VoxelGraphPlan {
  const legacy = params[EFFECT_GRAPH_PARAM] === undefined || params[EFFECT_GRAPH_PARAM] === '';
  const graph = voxelOperatorGraph(params);
  const errors = validateVoxelGraph(graph); if (errors.length) throw new Error(errors[0]);
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const input = (node: BoundOperatorNode, port: string) => {
    const found = nodes.get(graph.edges.find(edge => edge.to === node.id && edge.input === port)?.from ?? '');
    return found && (operatorEnabled(found, params) || found.operator === 'texture.uv' || found.operator.startsWith('math.') || found.operator === 'image.luminance') ? found : undefined;
  };
  const value = (node: BoundOperatorNode, name: string): OperatorValue => {
    const spec = getEffectOperator(node.operator)!.parameters.find(param => param.id === name)!;
    const binding = node.bindings[name];
    const fallback = typeof binding === 'string' ? VOXEL_RELIEF_PARAMS[binding]?.default ?? spec.default : spec.default;
    const result = typeof binding === 'string' ? params[binding] ?? fallback : fallback;
    if (spec.type === 'number' && (typeof result !== 'number' || !Number.isFinite(result))) {
      if (legacy) return Number.isFinite(Number(result)) ? Number(result) : spec.default;
      throw new Error(`Invalid ${spec.label}.`);
    }
    if (spec.type === 'boolean' && typeof result !== 'boolean') throw new Error(`Invalid ${spec.label}.`);
    return result as OperatorValue;
  };
  const copy = (node: BoundOperatorNode) => {
    for (const spec of getEffectOperator(node.operator)!.parameters) plan.params[spec.id] = value(node, spec.id) as number | boolean | string;
  };
  const textureUV = (texture?: BoundOperatorNode) => voxelTextureMapping(graph, texture, (node, key) => Number(value(node, key)), node => operatorEnabled(node, params));
  const plan: VoxelGraphPlan = { visible: false, heightUV: [1, 1, 0, 0], colorUV: [1, 1, 0, 0], tint: [1, 1, 1], opacity: 1, textured: true,
    boxSize: [1, 1, 1], maxHeight: 0, field: { operations: [], output: 0 },
    params: Object.fromEntries(Object.entries(VOXEL_RELIEF_PARAMS).map(([id, spec]) => [id, params[id] as number | boolean | string ?? spec.default])) };
  const render = graph.nodes.find(node => node.operator === 'render.voxel')!;
  copy(render);
  if (!operatorEnabled(render, params)) return plan;
  const mesh = input(render, 'scene');
  if (mesh?.operator !== 'scene.mesh') return plan;
  const geometry = input(mesh, 'geometry'), material = input(mesh, 'material');
  if (!geometry || material?.operator !== 'material.surface') return plan;
  if (geometry.operator === 'geometry.voxel') {
    const heightUV = textureUV(input(geometry, 'height')); if (!heightUV) return plan;
    copy(geometry); plan.heightUV = heightUV;
  } else if (geometry.operator === 'geometry.instances') {
    const grid = input(geometry, 'points'), box = input(geometry, 'geometry'), field = input(geometry, 'height');
    if (grid?.operator !== 'geometry.grid' || box?.operator !== 'geometry.box' || !field) return plan;
    copy(grid); copy(geometry);
    plan.boxSize = ['width', 'height', 'depth'].map((key, axis) => Math.max(0, Math.min(axis === 2 ? 4 : 1, Number(value(box, key))))) as [number, number, number];
    plan.field = compileScalarField(graph, field, (node, name) => Number(value(node, name)), node => operatorEnabled(node, params));
    if (plan.field.textureNodeId) {
      const heightUV = textureUV(nodes.get(plan.field.textureNodeId)); if (!heightUV) return plan;
      plan.heightUV = heightUV;
    }
    plan.maxHeight = Math.max(0, scalarFieldBounds(plan.field.operations, plan.field.output)[1]) * plan.boxSize[2];
  } else return plan;
  const colorUV = textureUV(input(material, 'texture'));
  plan.textured = !!colorUV; if (colorUV) plan.colorUV = colorUV;
  plan.tint = ['red', 'green', 'blue'].map(key => Number(value(material, key))) as [number, number, number];
  plan.opacity = Math.max(0, Math.min(1, Number(value(material, 'opacity'))));
  const camera = input(render, 'camera'), light = input(render, 'light');
  if (camera?.operator === 'camera.orbit') copy(camera);
  if (light?.operator === 'light.relief') copy(light);
  else { plan.params.ambient = 1; plan.params.lightStrength = 0; }
  plan.visible = true;
  return plan;
}
