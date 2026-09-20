import { readTimelineRuntimeState } from '../timeline/timelineRuntimeCoordinator';
import type { TimelineClip } from '../../types/timeline';
import type { PreviewArtifactReader } from './PreviewArtifactReader';
import type { PreviewDrawing, PreviewFrame, PreviewRequest } from './previewTypes';
import { sceneGraphForClip, compileSceneGraph } from '../operators/sceneGraph';
import { sourcePreview } from './sourcePreview';
import { nodePreviewTextureTap } from './NodePreviewTextureTap';
import { useTimelineStore } from '../../stores/timeline';
import { resolveSceneClipTransform } from '../../engine/scene/SceneTimelineUtils';

/** Geometry/data viewers use the same saved graph and interpolated clip transform as the scene. */
export function scenePreview(request: PreviewRequest, clip: TimelineClip, localTime: number, sourceTime: number, artifacts?: PreviewArtifactReader): PreviewFrame | Promise<PreviewFrame> {
  const base = { key: request.key, revision: request.revision, time: request.time };
  const missing = (label: string): PreviewFrame => ({ ...base, status: 'missing', label });
  const binding = request.node.binding;
  if (binding?.kind !== 'scene-operator') return missing('No scene output');
  const definition = sceneGraphForClip(clip), graph = definition.graph;
  const node = graph.nodes.find(value => value.id === binding.nodeId);
  if (!node) return missing('Node unavailable');
  if (node.operator === 'scene.render') return nodePreviewTextureTap.request(`scene:${clip.id}`, request);
  const input = (id: string, port: string) => graph.nodes.find(value => value.id === graph.edges.find(edge => edge.to === id && edge.input === port)?.from);
  const param = (id: string, name: string, fallback: number) => {
    const key = graph.nodes.find(value => value.id === id)?.bindings[name];
    return typeof key === 'string' && typeof definition.params[key] === 'number' ? Number(definition.params[key]) : fallback;
  };
  const uv = (id?: string, visited = new Set<string>()): number[] => {
    if (!id || visited.has(id)) return [1, 1, 0, 0];
    visited.add(id);
    const parent = uv(input(id, 'uv')?.id, visited);
    if (graph.nodes.find(value => value.id === id)?.bypassed) return parent;
    const sx = param(id, 'scaleU', 1), sy = param(id, 'scaleV', 1);
    return [parent[0] * sx, parent[1] * sy, parent[2] * sx + param(id, 'offsetU', 0), parent[3] * sy + param(id, 'offsetV', 0)];
  };
  if (node.operator === 'texture.uv') {
    const [sx, sy, x, y] = uv(node.id);
    return { ...base, status: 'live', label: 'UV coordinates', drawing: { kind: 'points', dimensions: 2,
      points: [x, y, x + sx, y, x + sx, y + sy, x, y + sy], edges: [0, 1, 1, 2, 2, 3, 3, 0] } };
  }
  if (node.operator === 'texture.image') {
    if (node.bypassed || !input(node.id, 'image')) return missing('Texture disconnected');
    return sourcePreview(request, clip, sourceTime);
  }
  if (node.operator === 'material.surface') return { ...base, status: 'live', label: node.bypassed ? 'Material muted' : 'Surface material',
    drawing: { kind: 'material', color: [param(node.id, 'red', 1), param(node.id, 'green', 1), param(node.id, 'blue', 1)], opacity: node.bypassed ? 0 : param(node.id, 'opacity', 1), textured: !!input(node.id, 'texture') } };
  let geometry = node, transformed = false;
  if (node.operator.startsWith('scene.')) {
    const render = graph.nodes.find(value => value.operator === 'scene.render');
    if (!render) return missing('Scene disconnected');
    const scoped = { ...definition, graph: { ...graph, edges: graph.edges.filter(edge => edge.to !== render.id).concat({ id: 'preview-output', from: node.id, output: 'scene', to: render.id, input: 'scene' }) } };
    const plan = compileSceneGraph(scoped);
    if (!plan.visible) return missing('Object disconnected');
    transformed = plan.applyClipTransform;
    let mesh = node;
    const seen = new Set<string>();
    while (mesh.operator === 'scene.clip-transform' && !seen.has(mesh.id)) { seen.add(mesh.id); mesh = input(mesh.id, 'scene') ?? mesh; }
    geometry = input(mesh.id, 'geometry') ?? node;
  }
  if (geometry.bypassed) return missing('Geometry muted');
  const transformGeometry = (drawing: PreviewDrawing | undefined): PreviewDrawing | undefined => {
    if (!transformed || drawing?.kind !== 'points' || drawing.dimensions !== 3) return drawing;
    const state = readTimelineRuntimeState(useTimelineStore), transform = resolveSceneClipTransform(clip, localTime, request.time, state);
    const { position: p, rotation: r, scale: s } = transform;
    const [rx, ry, rz] = [r.x, r.y, r.z].map(value => value * Math.PI / 180);
    const points = Array.from({ length: drawing.points.length / 3 }, (_, i) => {
      let x = drawing.points[i * 3] * s.x, y = drawing.points[i * 3 + 1] * s.y, z = drawing.points[i * 3 + 2] * (s.z ?? 1);
      [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
      [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
      return [x * Math.cos(rz) - y * Math.sin(rz) + p.x, x * Math.sin(rz) + y * Math.cos(rz) + p.y, z + p.z];
    }).flat();
    points.push(0, 0, 0);
    return { ...drawing, points };
  };
  const effect = clip.effects.find(value => value.enabled && value.type === 'face-cables' && value.params.sceneData);
  if (geometry.operator === 'geometry.source' && effect && artifacts) {
    return artifacts.sample(`${clip.id}:${effect.id}:scene`, String(effect.params.sceneData), 'scene', 'geometry', localTime).then(result => ({ ...base, status: 'saved', label: transformed ? 'Saved geometry · world space' : result.label, drawing: transformGeometry(result.drawing) }));
  }
  const source = clip.source;
  const ratio = (source?.videoElement?.videoWidth || source?.imageElement?.naturalWidth || source?.textCanvas?.width || 16)
    / (source?.videoElement?.videoHeight || source?.imageElement?.naturalHeight || source?.textCanvas?.height || 9);
  const w = param(geometry.id, 'width', 1) * ratio, h = param(geometry.id, 'height', 1);
  const points = [-w / 2, -h / 2, 0, w / 2, -h / 2, 0, w / 2, h / 2, 0, -w / 2, h / 2, 0];
  return { ...base, status: 'live', label: transformed ? 'World-space geometry' : 'Local geometry', drawing: transformGeometry({ kind: 'points', dimensions: 3, points, edges: [0, 1, 1, 2, 2, 3, 3, 0, 0, 2] }) };
}
