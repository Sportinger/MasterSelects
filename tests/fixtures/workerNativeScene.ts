import { FlockGraphBuilder } from '../../src/services/flock/presets/flockGraphBuilder';
import type { WorkerGpuFrameStackContractV1 } from '../../src/services/render/workerGpuFrameStackContract';
import type { WorkerGpuNativeScenePayload } from '../../src/services/render/workerGpuNativeSceneContract';
import type { WorkerGpuWebCodecsRenderLayer } from '../../src/services/render/workerGpuRuntimeCommands';

export function nativeSceneFixture(time = 0.2, now = 1000, requestId = 'native-request', render?: 'image' | 'model') {
  const graph = new FlockGraphBuilder();
  const emitter = graph.add('flock.emitter', { count: 512, shape: 'grid', center: [0, 0, 0], size: [4, 4, 2], initialSpeed: 1 });
  const simulation = graph.add('flock.simulation', { minSpeed: 0, maxSpeed: 2, stepRate: '60' });
  const points = render === 'model'
    ? graph.add('flock.render-instances', { mesh: 'model', model: 'stack-model', size: 0.2, color: '#ff3030', sizeVariance: 0, swimAmplitude: 0, shading: 'flat' })
    : graph.add('flock.render-points', { size: 8, blend: 'opaque', colorMode: render === 'image' ? 'image' : 'constant',
      image: render === 'image' ? 'stack-image' : '', color: render === 'image' ? '#ffffff' : '#20ff40', shading: 'flat', distanceFade: 0 });
  const output = graph.add('flock.output');
  graph.connect(emitter, 'spawn', simulation, 'spawn').connect(simulation, 'particles', points, 'particles').connect(points, 'scene', output, 'scene');
  const definition = graph.build('native-stack-probe');
  const ids = new Map(definition.nodes.map((node, i) => [node.id, `node${i}`]));
  definition.nodes.forEach(node => { node.id = ids.get(node.id)!; });
  definition.edges.forEach((edge, i) => { edge.id = `edge${i}`; edge.from.nodeId = ids.get(edge.from.nodeId)!; edge.to.nodeId = ids.get(edge.to.nodeId)!; });
  definition.layout = {};
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  const payload: WorkerGpuNativeScenePayload = { kind: 'native-scene', version: 1, width: 256, height: 256, timelineTime: time,
    camera: { viewMatrix: identity, projectionMatrix: [...identity], cameraPosition: { x: 0, y: 0, z: 10 },
      cameraTarget: { x: 0, y: 0, z: 0 }, cameraUp: { x: 0, y: 1, z: 0 }, fov: 45, near: 0.1, far: 100,
      viewport: { width: 256, height: 256 }, projection: 'orthographic', orthographicScale: 4 },
    layers: [{ kind: 'flock', layerId: 'particles', clipId: 'particles', opacity: 1,
      worldMatrix: [30, 0, 0, 0, 0, 30, 0, 0, 0, 0, 10, 0, 0, 0, 0.5, 1],
      definition, keyframes: [], sourceTime: time }] };
  const renderLayer = (id: string): WorkerGpuWebCodecsRenderLayer => ({ id, sourceClipId: id, name: id, visible: true,
    opacity: 1, blendMode: 'normal', position: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1 }, rotation: 0, effects: [] });
  const stack: WorkerGpuFrameStackContractV1 = { contractVersion: 'worker-gpu-frame-stack/v1', frameMode: 'exact-one-shot',
    occurrenceNamespace: 'native-root', dimensions: { width: 256, height: 256 },
    frame: { requestId, targetId: 'native-target', compositionId: 'native-comp', timelineTime: time,
      frameIndex: Math.round(time * 60), intent: 'preview', submitByMs: now, expireAfterMs: now + 120000, graphVersion: 1, exact: true },
    execution: { kind: 'ordered-sources', bottomToTopLayerIds: ['background', 'scene'] },
    bindings: [
      { layerId: 'background', runtimeSourceKind: 'solid', sourceKind: 'timeline-media', sourceId: 'timeline:background',
        renderLayer: renderLayer('background'), payload: { kind: 'solid', color: '#1020a0', width: 256, height: 256 } },
      { layerId: 'scene', runtimeSourceKind: 'nativeScene', sourceKind: 'timeline-media', sourceId: 'timeline:scene', renderLayer: renderLayer('scene'), payload },
    ] };
  const admission = { requestId: stack.frame.requestId, targetId: stack.frame.targetId, intent: stack.frame.intent, graphVersion: 1, nowMs: now };
  return { stack, admission, payload };
}
