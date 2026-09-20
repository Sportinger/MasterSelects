import type { EffectOperatorGraph, BoundOperatorNode } from '../../types/operatorGraph';
import type { Keyframe } from '../../types/keyframes';
import { EFFECT_GRAPH_PARAM, graphInputNodes, operatorEnabled, readEffectGraph, sampleOperatorParameter, evaluateGraphForces, type OperatorParameters } from '../operators/effectGraph';

/** Existing effect properties are the graph's parameter storage, including their existing keyframes. */
export function defaultCableOperatorGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    { id: 'source', operator: 'media.source', bindings: {} },
    { id: 'tracking', operator: 'tracking.face', bindings: {} },
    { id: 'anchors', operator: 'tracking.anchors', bindings: {} },
    { id: 'depth', operator: 'depth.estimate', bindings: { strength: 'sceneDepthStrength' }, enabled: 'sceneDepth', enabledDefault: false },
    { id: 'surface', operator: 'surface.hybrid', bindings: {} },
    { id: 'face-contact', operator: 'collision.face', bindings: {}, enabled: 'faceCollision', enabledDefault: false },
    { id: 'depth-contact', operator: 'collision.surface', bindings: {}, enabled: 'sceneDepthCollision' },
    { id: 'wind', operator: 'forces.wind', bindings: { strength: 'globalWindStrength', gust: 'globalWindGusts', direction: { yaw: 'globalWindYaw', pitch: 'globalWindPitch' } }, enabled: 'sharedWind', enabledDefault: false },
    { id: 'simulation', operator: 'simulation.rope', bindings: {} },
    { id: 'render', operator: 'render.cables', bindings: { scene3D: 'scene3D', shadows: 'faceShadows' } },
    { id: 'transform', operator: 'scene.transform', bindings: {} },
    { id: 'output', operator: 'scene.output', bindings: {} },
  ];
  const edges = [
    ['source', 'image', 'tracking', 'image'], ['source', 'image', 'depth', 'image'],
    ['tracking', 'landmarks', 'anchors', 'landmarks'], ['tracking', 'landmarks', 'surface', 'landmarks'],
    ['depth', 'depth', 'surface', 'depth'], ['tracking', 'landmarks', 'face-contact', 'landmarks'],
    ['surface', 'surface', 'depth-contact', 'surface'], ['anchors', 'anchors', 'simulation', 'anchors'],
    ['face-contact', 'surface', 'simulation', 'colliders'], ['depth-contact', 'surface', 'simulation', 'colliders'],
    ['wind', 'force', 'simulation', 'forces'], ['simulation', 'curves', 'render', 'curves'],
    ['surface', 'surface', 'render', 'surface'], ['render', 'scene', 'transform', 'scene'], ['transform', 'scene', 'output', 'scene'],
  ].map(([from, output, to, input]) => ({ id: `${from}-${to}`, from, output, to, input }));
  const positions = [[0, 160], [250, 0], [500, 0], [250, 320], [500, 260], [750, 0], [750, 250], [750, 470], [1020, 150], [1300, 150], [1550, 150], [1800, 150]];
  return { version: 1, nodes, edges, layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: positions[i][0], y: positions[i][1] }])) };
}

export function cableOperatorGraph(params: OperatorParameters) { return readEffectGraph(params[EFFECT_GRAPH_PARAM], defaultCableOperatorGraph); }

/** Compile the connected group into inputs for the existing rope/depth/render executors. */
export function compileCableOperatorGraph(params: OperatorParameters) {
  const graph = cableOperatorGraph(params);
  const output = graph.nodes.find(n => n.operator === 'scene.output')!;
  const expectInput = (node: BoundOperatorNode, input: string, operator: string) => {
    const value = graphInputNodes(graph, node.id, input)[0];
    if (value?.operator !== operator) throw new Error(`Connect ${operator} to ${node.operator}.`);
    return value;
  };
  const transform = expectInput(output, 'scene', 'scene.transform');
  const render = expectInput(transform, 'scene', 'render.cables');
  const simulation = expectInput(render, 'curves', 'simulation.rope');
  const anchors = expectInput(simulation, 'anchors', 'tracking.anchors');
  const tracking = expectInput(anchors, 'landmarks', 'tracking.face');
  const source = expectInput(tracking, 'image', 'media.source');
  const surfaces = graphInputNodes(graph, render.id, 'surface');
  const surface = surfaces.find(n => n.operator === 'surface.hybrid');
  const depth = surface && graphInputNodes(graph, surface.id, 'depth').find(n => n.operator === 'depth.estimate');
  const contacts = graphInputNodes(graph, simulation.id, 'colliders').filter(n => operatorEnabled(n, params));
  if (surfaces.some(n => n.operator !== 'surface.hybrid')) throw new Error('Cable rendering requires the face + depth surface.');
  if (surface && expectInput(surface, 'landmarks', 'tracking.face').id !== tracking.id) throw new Error('Use the same face tracking for anchors and surface.');
  if (depth && expectInput(depth, 'image', 'media.source').id !== source.id) throw new Error('Depth and tracking must use the same source.');
  for (const contact of contacts) {
    if (contact.operator === 'collision.face') {
      if (expectInput(contact, 'landmarks', 'tracking.face').id !== tracking.id) throw new Error('Face collision must use the tracked face.');
    } else if (contact.operator === 'collision.surface') {
      if (expectInput(contact, 'surface', 'surface.hybrid').id !== surface?.id) throw new Error('Surface collision must use the rendered surface.');
    } else throw new Error('Connect a collision node to the simulation.');
  }
  const renderValue = (id: string) => sampleOperatorParameter(render, id, params, '', [], 0);
  const effective: OperatorParameters = { ...params, scene3D: Boolean(renderValue('scene3D')), faceShadows: Boolean(renderValue('shadows')),
    sceneDepth: Boolean(depth && operatorEnabled(depth, params)),
    sceneDepthStrength: depth ? Number(sampleOperatorParameter(depth, 'strength', params, '', [], 0)) : 1,
    faceCollision: contacts.some(n => n.operator === 'collision.face'),
    sceneDepthCollision: contacts.some(n => n.operator === 'collision.surface'),
  };
  return { graph, params: effective, forces: (effectId: string, keys: Keyframe[], time: number) => evaluateGraphForces(graph, simulation.id, params, effectId, keys, time) };
}
