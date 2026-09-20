import type { EffectOperatorGraph, BoundOperatorNode } from '../../types/operatorGraph';
import { migrateCableGraph } from './cableGraphMigration';
import { cableGraphLandmarks } from './cableGraphLandmarks';
import type { Keyframe } from '../../types/keyframes';
import { EFFECT_GRAPH_PARAM, graphInputNodes, operatorEnabled, readEffectGraph, sampleOperatorParameter, evaluateGraphForces, type OperatorParameters } from '../operators/effectGraph';

/** Existing effect properties are the graph's parameter storage, including their existing keyframes. */
export function defaultCableOperatorGraph(): EffectOperatorGraph {
  const nodes: BoundOperatorNode[] = [
    { id: 'source', operator: 'media.source', bindings: {} },
    { id: 'tracking', operator: 'tracking.face', bindings: {} },
    { id: 'smoothing', operator: 'tracking.smooth', bindings: { strength: 'trackingSmoothing' } },
    { id: 'anchors', operator: 'tracking.anchors', bindings: {} },
    { id: 'depth', operator: 'depth.estimate', bindings: {}, enabled: 'sceneDepth', enabledDefault: false },
    { id: 'face-mesh', operator: 'geometry.face', bindings: {} },
    { id: 'calibration', operator: 'depth.calibrate', bindings: { strength: 'sceneDepthStrength' } },
    { id: 'depth-mesh', operator: 'geometry.depth', bindings: {} },
    { id: 'surface', operator: 'geometry.merge-surface', bindings: { blendWidth: 'surfaceBlendWidth', subdivisions: 'surfaceSubdivisions' } },
    { id: 'face-contact', operator: 'collision.mesh', bindings: {}, enabled: 'faceCollision', enabledDefault: false },
    { id: 'depth-contact', operator: 'collision.mesh', bindings: {}, enabled: 'sceneDepthCollision' },
    { id: 'wind', operator: 'forces.wind', bindings: { strength: 'globalWindStrength', gust: 'globalWindGusts', direction: { yaw: 'globalWindYaw', pitch: 'globalWindPitch' } }, enabled: 'sharedWind', enabledDefault: false },
    { id: 'simulation', operator: 'simulation.rope', bindings: {} },
    { id: 'render', operator: 'render.cables', bindings: { scene3D: 'scene3D', shadows: 'faceShadows' } },
    { id: 'transform', operator: 'scene.transform', bindings: {} },
    { id: 'output', operator: 'scene.output', bindings: {} },
  ];
  const edges = [
    ['source', 'image', 'tracking', 'image'], ['source', 'image', 'depth', 'image'],
    ['tracking', 'landmarks', 'smoothing', 'landmarks'],
    ['smoothing', 'landmarks', 'anchors', 'landmarks'], ['smoothing', 'landmarks', 'face-mesh', 'landmarks'],
    ['depth', 'depth', 'calibration', 'depth'], ['face-mesh', 'geometry', 'calibration', 'reference'],
    ['calibration', 'depth', 'depth-mesh', 'depth'], ['face-mesh', 'geometry', 'surface', 'primary'], ['depth-mesh', 'geometry', 'surface', 'background'],
    ['face-mesh', 'geometry', 'face-contact', 'geometry'], ['surface', 'geometry', 'depth-contact', 'geometry'], ['anchors', 'anchors', 'simulation', 'anchors'],
    ['face-contact', 'surface', 'simulation', 'colliders'], ['depth-contact', 'surface', 'simulation', 'colliders'],
    ['wind', 'force', 'simulation', 'forces'], ['simulation', 'curves', 'render', 'curves'],
    ['surface', 'geometry', 'render', 'surface'], ['render', 'scene', 'transform', 'scene'], ['transform', 'scene', 'output', 'scene'],
  ].map(([from, output, to, input]) => ({ id: `${from}-${to}`, from, output, to, input }));
  const positions = [[0, 80], [250, 80], [500, 80], [750, 80], [250, 700], [750, 430], [1000, 700], [1250, 700], [1510, 430], [1860, 80], [1860, 330], [1860, 600], [2140, 230], [2500, 230], [2750, 230], [3000, 230]];
  return { version: 1, domain: 'cables', nodes, edges, layout: Object.fromEntries(nodes.map((n, i) => [n.id, { x: positions[i][0], y: positions[i][1] }])), groups: cableGroups(nodes) };
}

function cableGroups(nodes: BoundOperatorNode[]): NonNullable<EffectOperatorGraph['groups']> {
  const groups = [
    { id: 'tracking', label: 'Tracking', color: '#5d9bbe', nodeIds: ['source', 'tracking', 'smoothing', 'anchors'] },
    { id: 'surface', label: 'Surface & depth', color: '#b28dca', nodeIds: ['depth', 'face-mesh', 'calibration', 'depth-mesh', 'surface'] },
    { id: 'simulation', label: 'Cable physics', color: '#7fa768', nodeIds: ['face-contact', 'depth-contact', 'wind', 'simulation'] },
    { id: 'rendering', label: 'Cable rendering', color: '#c89c60', nodeIds: ['render', 'transform', 'output'] },
  ];
  return groups.map(g => ({ ...g, nodeIds: g.nodeIds.filter(id => nodes.some(n => n.id === id)) }));
}
export function cableOperatorGraph(params: OperatorParameters) {
  const graph = readEffectGraph(params[EFFECT_GRAPH_PARAM], defaultCableOperatorGraph, migrateCableGraph);
  return graph.groups ? graph : { ...graph, groups: cableGroups(graph.nodes) };
}

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
  const landmarkSource = graphInputNodes(graph, anchors.id, 'landmarks')[0];
  const landmarks = cableGraphLandmarks(graph, landmarkSource, params);
  const matchingLandmarks = (node: BoundOperatorNode) => cableGraphLandmarks(graph, graphInputNodes(graph, node.id, 'landmarks')[0], params).signature === landmarks.signature;
  const surface = graphInputNodes(graph, render.id, 'surface')[0];
  if (surface && surface.operator !== 'geometry.merge-surface') throw new Error('Connect Stitch Surfaces to Cable rendering.');
  const faceMesh = surface && graphInputNodes(graph, surface.id, 'primary')[0];
  const depthMesh = surface && graphInputNodes(graph, surface.id, 'background')[0];
  if (faceMesh && (faceMesh.operator !== 'geometry.face' || !matchingLandmarks(faceMesh))) throw new Error('The primary mesh must use the same tracked landmarks as the anchors.');
  if (depthMesh && depthMesh.operator !== 'geometry.depth') throw new Error('Connect Depth to mesh as the background surface.');
  const depthInput = depthMesh && graphInputNodes(graph, depthMesh.id, 'depth')[0];
  const useSavedDepth = depthInput?.operator === 'source.saved-depth';
  const calibration = useSavedDepth ? undefined : depthInput;
  if (calibration && calibration.operator !== 'depth.calibrate') throw new Error('Calibrate depth before creating its mesh.');
  const depth = useSavedDepth ? depthInput : calibration && graphInputNodes(graph, calibration.id, 'depth')[0];
  if (depth && !useSavedDepth && (depth.operator !== 'depth.estimate' || expectInput(depth, 'image', 'media.source').id !== landmarks.sourceId)) throw new Error('Depth and tracking must use the same source.');
  const reference = calibration && graphInputNodes(graph, calibration.id, 'reference')[0];
  if (reference && (reference.operator !== 'geometry.face' || !matchingLandmarks(reference))) throw new Error('Calibration requires matching reference geometry.');
  const contacts = graphInputNodes(graph, simulation.id, 'colliders').filter(n => operatorEnabled(n, params));
  const contactInputs = contacts.map(n => {
    if (n.operator !== 'collision.mesh') throw new Error('Connect Mesh collision to the simulation.');
    const geometry = graphInputNodes(graph, n.id, 'geometry')[0];
    if (geometry?.operator === 'geometry.face' && matchingLandmarks(geometry)) return 'face';
    if (geometry?.id === surface?.id) return 'surface';
    throw new Error('Collision must use the same mesh as rendering.');
  });
  const surfacePlan = {
    face: Boolean(faceMesh),
    blendWidth: surface ? Number(sampleOperatorParameter(surface, 'blendWidth', params, '', [], 0)) : 0.05,
    subdivisions: surface ? Math.round(Number(sampleOperatorParameter(surface, 'subdivisions', params, '', [], 0))) : 4,
  };
  if (!Number.isFinite(surfacePlan.blendWidth) || surfacePlan.blendWidth < 0 || surfacePlan.blendWidth > 0.2
    || !Number.isFinite(surfacePlan.subdivisions) || surfacePlan.subdivisions < 0 || surfacePlan.subdivisions > 5) throw new Error('Invalid surface merge parameters.');
  const renderValue = (id: string) => sampleOperatorParameter(render, id, params, '', [], 0);
  const effective: OperatorParameters = { ...params, scene3D: Boolean(renderValue('scene3D')), faceShadows: Boolean(renderValue('shadows')),
    trackingSmoothing: landmarks.strength,
    sceneDepth: Boolean(depth && operatorEnabled(depth, params)),
    sceneDepthStrength: calibration ? Number(sampleOperatorParameter(calibration, 'strength', params, '', [], 0)) : 1,
    faceCollision: contactInputs.includes('face') || (contactInputs.includes('surface') && surfacePlan.face && Boolean(depth && operatorEnabled(depth, params))),
    depthReferenceFace: Boolean(reference),
    sceneDepthCollision: contactInputs.includes('surface'),
  };
  return { graph, params: effective, surfacePlan, useSavedDepth: useSavedDepth && Boolean(effective.sceneDepth), forces: (effectId: string, keys: Keyframe[], time: number) => evaluateGraphForces(graph, simulation.id, params, effectId, keys, time) };
}
