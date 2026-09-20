import type { BoundOperatorNode, SceneOperatorGraph, SceneSurfacePlan } from '../../types/operatorGraph';
import { validateEffectGraph } from './effectGraph';
import { SCENE_OPERATORS } from './sceneOperators';
import type { TimelineClip } from '../../types/timeline';

export function sceneGraphForClip(clip: TimelineClip): SceneOperatorGraph {
  return clip.nodeGraph?.scene ?? defaultSceneGraph(clip.effects.some(e => e.enabled && e.type === 'face-cables' && Boolean(e.params.scene3D)));
}

export function defaultSceneGraph(sourceGeometry = false): SceneOperatorGraph {
  const definitions = [
    ['frame', 'image.frame', 0, 0], ['uv', 'texture.uv', 0, 210], ['texture', 'texture.image', 270, 0],
    ['material', 'material.surface', 540, 0], ['geometry', sourceGeometry ? 'geometry.source' : 'geometry.plane', 540, 440],
    ['mesh', 'scene.mesh', 810, 100], ['transform', 'scene.clip-transform', 1080, 100], ['render', 'scene.render', 1350, 100],
  ] as const;
  const params: SceneOperatorGraph['params'] = {};
  const nodes: BoundOperatorNode[] = definitions.map(([id, operator]) => {
    const bindings: BoundOperatorNode['bindings'] = {};
    for (const p of SCENE_OPERATORS.find(o => o.id === operator)!.parameters) { bindings[p.id] = `${id}_${p.id}`; params[`${id}_${p.id}`] = p.default; }
    return { id, operator, bindings };
  });
  const edges = [['frame', 'image', 'texture', 'image'], ['uv', 'uv', 'texture', 'uv'], ['texture', 'texture', 'material', 'texture'],
    ['geometry', 'geometry', 'mesh', 'geometry'], ['material', 'material', 'mesh', 'material'], ['mesh', 'scene', 'transform', 'scene'], ['transform', 'scene', 'render', 'scene']]
    .map(([from, output, to, input]) => ({ id: `${from}-${to}`, from, output, to, input }));
  return { params, graph: { version: 1, domain: 'scene', nodes, edges,
    layout: Object.fromEntries(definitions.map(([id, , x, y]) => [id, { x, y }])),
    groups: [{ id: 'surface', label: 'Texture & material', color: '#b484d2', nodeIds: ['frame', 'uv', 'texture', 'material'] }],
  } };
}

export function validateSceneGraph(definition: SceneOperatorGraph, allowIncomplete = false): string[] {
  if (!definition || !definition.params || typeof definition.params !== 'object' || definition.graph?.domain !== 'scene') return ['Invalid saved scene graph.'];
  const errors = validateEffectGraph(definition.graph, allowIncomplete);
  if (errors.length) return errors;
  if (definition.graph.nodes.some(n => !SCENE_OPERATORS.some(o => o.id === n.operator))) errors.push('Unsupported scene operator.');
  return errors;
}

/** Evaluate only the connected output. No hidden fallback to the old graph after rewiring. */
export function compileSceneGraph(definition: SceneOperatorGraph): SceneSurfacePlan {
  const errors = validateSceneGraph(definition); if (errors.length) throw new Error(errors[0]);
  const { graph, params } = definition;
  const nodes = new Map(graph.nodes.map(n => [n.id, n]));
  const input = (node: BoundOperatorNode, port: string) => {
    const source = nodes.get(graph.edges.find(e => e.to === node.id && e.input === port)?.from ?? '');
    return source?.bypassed && !['texture.uv', 'scene.clip-transform'].includes(source.operator) ? undefined : source;
  };
  const number = (node: BoundOperatorNode, name: string): number => {
    const spec = SCENE_OPERATORS.find(o => o.id === node.operator)!.parameters.find(p => p.id === name)!;
    const key = node.bindings[name], value = typeof key === 'string' ? params[key] ?? spec.default : spec.default;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid ${spec.label}.`);
    return Math.min(spec.max ?? Infinity, Math.max(spec.min ?? -Infinity, value));
  };
  const uv = (node?: BoundOperatorNode): [number, number, number, number] => {
    if (!node) return [1, 1, 0, 0];
    if (node.bypassed) return uv(input(node, 'uv'));
    const parent = uv(input(node, 'uv')), sx = number(node, 'scaleU'), sy = number(node, 'scaleV');
    const result: [number, number, number, number] = [parent[0] * sx, parent[1] * sy, parent[2] * sx + number(node, 'offsetU'), parent[3] * sy + number(node, 'offsetV')];
    if (result.some(v => !Number.isFinite(v) || Math.abs(v) > 1e6)) throw new Error('Combined UV transform exceeds its supported range.');
    return result;
  };
  const plan: SceneSurfacePlan = { visible: false, geometry: 'source', applyClipTransform: false, width: 1, height: 1, textured: false, uv: [1, 1, 0, 0], tint: [1, 1, 1], opacity: 1 };
  const render = graph.nodes.find(n => n.operator === 'scene.render')!;
  if (render.bypassed) return plan;
  let object = input(render, 'scene');
  const transforms = new Set<string>();
  while (object?.operator === 'scene.clip-transform') {
    if (!object.bypassed) transforms.add(object.id);
    object = input(object, 'scene');
  }
  if (transforms.size > 1) throw new Error('Apply the clip transform once; connect additional meshes to one transform.');
  plan.applyClipTransform = transforms.size > 0;
  if (object?.operator !== 'scene.mesh') return plan;
  const geometry = input(object, 'geometry'), material = input(object, 'material');
  if (!geometry || !material) return plan;
  plan.geometry = geometry.operator === 'geometry.plane' ? 'plane' : 'source';
  if (plan.geometry === 'plane') { plan.width = number(geometry, 'width'); plan.height = number(geometry, 'height'); }
  plan.tint = [number(material, 'red'), number(material, 'green'), number(material, 'blue')]; plan.opacity = number(material, 'opacity');
  const texture = input(material, 'texture');
  if (texture) { plan.textured = input(texture, 'image')?.operator === 'image.frame'; plan.uv = uv(input(texture, 'uv')); }
  plan.visible = true;
  return plan;
}

export function sceneGraphSupportsSource(sourceType?: string, cable = false, voxel = false): boolean {
  return cable || (!voxel && !['model', 'gaussian-splat', 'gaussian-avatar', 'flock', 'camera', 'light', 'splat-effector'].includes(sourceType ?? ''));
}
