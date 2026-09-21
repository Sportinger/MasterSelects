import type { NodeGraph, NodeGraphNode } from '../../../../../types/nodeGraph';
import type { AnimatableProperty } from '../../../../../types/animationProperties';
import type { Keyframe } from '../../../../../types/keyframes';
import type { TimelineClip } from '../../../../../types/timeline';
import { describeNodePort } from '../../../../../services/nodeGraph/nodePortPresentation';
import { keyframeNodeParameters } from '../../../../../services/nodeGraph/keyframeNodeParameters';
import { clipLocalToKeyframeTime, getKeyframeTimeBasis, type SourceOffsetResolver } from '../../../../../services/flock/time/flockKeyframeTime';
import { interpolateKeyframes } from '../../../../../utils/keyframeInterpolation';
import { keyframesForProperty } from '../../../../../utils/keyframePropertyIndex';
import { getNodeBadges, getNodeHeight, getNodePortStartY, getPortCenter, isNodeBypassable, isNodeBypassed, NODE_WIDTH, type ConnectionDraft } from '../canvasGeometry';
import { nodeGroupBounds } from '../groupBounds';
import type { ConnectionPlug } from '../connectionPlugs';
import type { HoveredNodePort } from '../useNodePortHover';
import type { CanvasCurve, CanvasScene } from './nodeCanvasTypes';
import { makeCanvasCable } from './cableGeometry';
import { inlineNumericPorts, previewRect } from '../../previews/previewGeometry';
import { previewOutput } from '../../../../../services/nodePreview/previewTypes';

const COLORS: Record<string, string> = { source: '#54be8e', transform: '#5299eb', motion: '#5299eb', color: '#e0c24a', mask: '#be6fd5', effect: '#de8452', custom: '#5cbed6', analysis: '#70f6dc', output: '#97a9be' };
const EMPTY: Keyframe[] = [];
interface Options {
  graph: NodeGraph; nodes: NodeGraphNode[]; plugs: ConnectionPlug[];
  groupFrameNodes?: NodeGraphNode[];
  selectedNodeId: string | null; selection: Set<string>; selectedEdgeId: string | null; hoveredEdgeId: string | null;
  hoveredPort: HoveredNodePort | null; draft: ConnectionDraft | null;
  clips: TimelineClip[]; keyframes: Map<string, Keyframe[]>; sourceTime: SourceOffsetResolver;
  canBypass?: boolean;
}

// Curves depend on clip/keyframe edits, not pan, hover, selection or playback.
const curveCache = new WeakMap<TimelineClip, Map<string, { keys: Keyframe[]; resolver: SourceOffsetResolver; curve: CanvasCurve }>>();
function curveFor(node: NodeGraphNode, options: Options): CanvasCurve | undefined {
  const badge = !!node.animation?.channels.length;
  const property = (badge ? node.animation!.channels[0].property : node.outputs[0]?.metadata?.animationProperty) as AnimatableProperty | undefined;
  if (!badge && node.binding?.kind !== 'keyframe-node') return;
  const clip = options.clips.find(c => c.id === (badge ? node.animation!.clipId : node.params?.targetClipId));
  if (!clip || !property) return;
  const keys = options.keyframes.get(clip.id) ?? EMPTY;
  let cache = curveCache.get(clip);
  if (!cache) { cache = new Map(); curveCache.set(clip, cache); }
  const cacheKey = `${badge}:${property}:${getNodePortStartY(node)}:${node.animation?.channels.length ?? 0}`;
  const cached = cache.get(cacheKey);
  if (cached?.keys === keys && cached.resolver === options.sourceTime) return cached.curve;
  const value = keyframeNodeParameters(clip).find(p => p.property === property)?.value ?? 0;
  const points = Array.from({ length: 81 }, (_, i) => interpolateKeyframes(keys, property,
    clipLocalToKeyframeTime(clip, property, i / 80 * clip.duration, options.sourceTime), value));
  const min = Math.min(...points), span = Math.max(...points) - min || 1;
  const curve: CanvasCurve = { x: 12, y: badge ? getNodePortStartY(node) - 78 : 86, width: 160, height: badge ? 52 : 70,
    clipId: clip.id, start: clip.startTime, duration: clip.duration, property, sourceTime: getKeyframeTimeBasis(property) === 'source',
    keys: [...keyframesForProperty(keys, property)], value, points: points.map(v => (v - min) / span),
    compactBadge: badge, channels: node.animation?.channels.length ?? 1,
    activityKeys: node.animation?.channels.map(channel => ({ property: channel.property, keys: [...keyframesForProperty(keys, channel.property)],
      sourceTime: getKeyframeTimeBasis(channel.property) === 'source' })) ?? [] };
  cache.set(cacheKey, { keys, resolver: options.sourceTime, curve });
  return curve;
}

export function buildCanvasScene(options: Options): CanvasScene {
  const { graph, nodes, plugs, draft, hoveredPort } = options;
  const bounds = nodeGroupBounds(graph, options.groupFrameNodes ?? nodes);
  const scene: CanvasScene = { nodes: [], cables: [], groups: [], plugs: [] };
  for (const group of graph.groups ?? []) {
    const b = bounds.get(group.id);
    if (b) scene.groups.push({ x: b.left, y: b.top, width: b.right - b.left, height: b.bottom - b.top,
      label: group.label, color: group.color ?? '#5cbed6', collapsed: !!group.collapsed,
      count: group.collapsed && group.bypassNodeId ? '' : `${group.nodeIds.length} nodes`,
      bypassable: !!group.bypassNodeId, bypassed: nodes.find(node => node.id === group.bypassNodeId)?.params?.enabled === false });
  }
  scene.nodes = nodes.map(node => ({ id: node.id, x: node.layout.x, y: node.layout.y, width: NODE_WIDTH, height: getNodeHeight(node),
    label: node.label, description: inlineNumericPorts(node) ? '' : node.description ?? 'Built-in processing node', kind: typeof node.params?.categoryLabel === 'string' ? node.params.categoryLabel : node.kind,
    runtime: node.runtime, color: COLORS[node.kind] ?? '#5cbed6', selected: node.id === options.selectedNodeId || options.selection.has(node.id),
    viewerEnabled: node.preview?.requested,
    preview: node.preview?.enabled ? { ...previewRect(getNodeHeight(node), node), key: node.preview.key, label: previewOutput(node, node.preview.portId)?.label ?? 'Values', text: inlineNumericPorts(node) } : undefined,
    bypassed: isNodeBypassed(node), bypassable: !!options.canBypass && isNodeBypassable(node), badges: getNodeBadges(node), curve: curveFor(node, options),
    ports: [...node.inputs, ...node.outputs].map(port => {
      const info = describeNodePort(port), center = getPortCenter(node, port.id, port.direction)!;
      return { x: center.x - node.layout.x, y: center.y - node.layout.y, label: port.label, type: inlineNumericPorts(node) ? '' : info.typeLabel, color: info.color, input: port.direction === 'input' };
    }) }));
  const pairs = new Map<string, { input?: ConnectionPlug; output?: ConnectionPlug }>();
  for (const plug of plugs) {
    const pair = pairs.get(plug.edge.id) ?? {};
    pair[plug.port.direction] = plug; pairs.set(plug.edge.id, pair);
    if (draft?.reconnectEdgeId === plug.edge.id && draft.moved && draft.direction !== plug.port.direction) continue;
    scene.plugs.push({ center: plug.center, tip: plug.tip, input: plug.port.direction === 'input', color: describeNodePort(plug.port).color,
      highlighted: plug.edge.id === options.selectedEdgeId || plug.edge.id === options.hoveredEdgeId || (hoveredPort?.node.id === plug.node.id && hoveredPort.port.id === plug.port.id) });
  }
  for (const [id, pair] of pairs) {
    if (!pair.output || !pair.input || (draft?.moved && draft.reconnectEdgeId === id)) continue;
    scene.cables.push({ ...makeCanvasCable(pair.output.tip, pair.input.tip, describeNodePort(pair.output.port).color, id === options.selectedEdgeId || id === options.hoveredEdgeId),
      baked: pair.output.edge.readOnly });
  }
  const preview = (nodeId: string, portId: string, direction: 'input' | 'output', ghost = false) => {
    const node = nodes.find(n => n.id === nodeId), port = (direction === 'input' ? node?.inputs : node?.outputs)?.find(p => p.id === portId);
    if (!node || !port) return null;
    const center = getPortCenter(node, portId, direction)!;
    const tip = { x: center.x + (direction === 'input' ? -24 : 24), y: center.y };
    scene.plugs.push({ center, tip, input: direction === 'input', color: describeNodePort(port).color, highlighted: true, ghost });
    return tip;
  };
  if (hoveredPort && !plugs.some(p => p.node.id === hoveredPort.node.id && p.port.id === hoveredPort.port.id)) preview(hoveredPort.node.id, hoveredPort.port.id, hoveredPort.port.direction);
  if (draft && (!draft.reconnectEdgeId || draft.moved)) {
    const pair = draft.reconnectEdgeId ? pairs.get(draft.reconnectEdgeId) : undefined;
    const start = pair?.[draft.direction]?.tip ?? preview(draft.nodeId, draft.portId, draft.direction);
    const end = draft.target ? preview(draft.target.nodeId, draft.target.portId, draft.target.direction, true)
      : { x: draft.end.x + (draft.direction === 'output' ? -21 : 21), y: draft.end.y };
    const node = nodes.find(n => n.id === draft.nodeId), port = (draft.direction === 'input' ? node?.inputs : node?.outputs)?.find(p => p.id === draft.portId);
    const color = port ? describeNodePort(port).color : '#afbdd0';
    if (start && end) scene.cables.push(makeCanvasCable(draft.direction === 'output' ? start : end, draft.direction === 'output' ? end : start, color, true, true));
    if (!draft.target && end) scene.plugs.push({ center: draft.end, tip: end, input: draft.direction === 'output', color, highlighted: true });
  }
  return scene;
}
