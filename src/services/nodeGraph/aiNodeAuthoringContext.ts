import type { ClipCustomNodeDefinition, NodeGraph, NodeGraphEdge, NodeGraphNode, TimelineClip, TimelineTrack } from '../../types';
import { createTextLayoutSnapshot } from '../textLayout';
import { buildClipNodeGraph } from './clipGraphProjection';

interface AINodeAuthoringProjectContext {
  clips?: TimelineClip[];
  tracks?: TimelineTrack[];
}

const MAX_CONTEXT_CLIPS = 24;
const MAX_CONTEXT_NODES = 48;
const MAX_CONTEXT_EDGES = 96;
const MAX_TEXT_CONTEXT_CHARS = 1200;
const MAX_TEXT_PREVIEW_CHARS = 160;
const MAX_TEXT_LAYOUT_LINES = 24;
const MAX_TEXT_LAYOUT_CHARACTERS = 80;

function truncateContextValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength)}...[truncated ${value.length - maxLength} chars]`;
}

function formatQuoted(value: string, maxLength: number): string {
  return JSON.stringify(truncateContextValue(value, maxLength));
}

function formatPortList(node: NodeGraphNode, direction: 'input' | 'output'): string {
  const ports = direction === 'input' ? node.inputs : node.outputs;
  if (ports.length === 0) {
    return 'none';
  }

  return ports.map((port) => `${port.id}:${port.type}`).join(', ');
}

function formatParamSummary(node: NodeGraphNode): string {
  const entries = Object.entries(node.params ?? {});
  if (entries.length === 0) {
    return 'none';
  }

  return entries
    .slice(0, 10)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(', ');
}

function formatCustomParamSchema(definition: ClipCustomNodeDefinition): string {
  const schema = definition.parameterSchema ?? [];
  if (schema.length === 0) {
    return 'none';
  }

  return schema
    .slice(0, 12)
    .map((param) => `${param.id}:${param.type}=default(${String(param.default)}) current(${String(definition.params?.[param.id] ?? param.default)})`)
    .join(', ');
}

function formatNode(node: NodeGraphNode): string {
  return [
    `- ${node.id}`,
    `kind=${node.kind}`,
    `runtime=${node.runtime}`,
    `label="${node.label}"`,
    `inputs=[${formatPortList(node, 'input')}]`,
    `outputs=[${formatPortList(node, 'output')}]`,
    `params=[${formatParamSummary(node)}]`,
  ].join(' ');
}

function formatEdge(edge: NodeGraphEdge): string {
  return `- ${edge.fromNodeId}.${edge.fromPortId} -> ${edge.toNodeId}.${edge.toPortId} (${edge.type})`;
}

function getDirectEdges(graph: NodeGraph, nodeId: string): NodeGraphEdge[] {
  return graph.edges.filter((edge) => edge.fromNodeId === nodeId || edge.toNodeId === nodeId);
}

function formatClip(clip: TimelineClip, tracksById: Map<string, TimelineTrack>, currentClipId: string): string {
  const track = tracksById.get(clip.trackId);
  return [
    `- ${clip.id}${clip.id === currentClipId ? ' (current)' : ''}`,
    `name="${clip.name}"`,
    `source=${clip.source?.type ?? 'unknown'}`,
    `file="${clip.file?.name ?? 'unknown'}"`,
    `track="${track?.name ?? clip.trackId}"`,
    `start=${clip.startTime}`,
    `duration=${clip.duration}`,
    `effects=${clip.effects.length}`,
    `customNodes=${clip.nodeGraph?.customNodes?.length ?? 0}`,
    clip.textProperties ? `text=${formatQuoted(clip.textProperties.text, MAX_TEXT_PREVIEW_CHARS)}` : '',
    clip.textProperties ? `font=${clip.textProperties.fontFamily}/${clip.textProperties.fontSize}px/${clip.textProperties.fontWeight}` : '',
  ].join(' ');
}

function formatTextBounds(clip: TimelineClip): string {
  const bounds = clip.textProperties?.textBounds;
  if (!bounds) {
    return 'none';
  }

  const vertices = bounds.vertices
    .slice(0, 12)
    .map((vertex) => `${vertex.id}:${vertex.x.toFixed(3)},${vertex.y.toFixed(3)}`)
    .join(' ');
  const omitted = bounds.vertices.length > 12 ? ` ... ${bounds.vertices.length - 12} more` : '';
  return `closed=${bounds.closed} position=${bounds.position.x},${bounds.position.y} vertices=[${vertices}${omitted}]`;
}

function createMeasureContext(clip: TimelineClip): Pick<CanvasRenderingContext2D, 'font' | 'measureText'> | null {
  if (typeof document === 'undefined') {
    return null;
  }

  const canvas = clip.source?.textCanvas ?? document.createElement('canvas');
  return canvas.getContext('2d');
}

function formatTextLayout(clip: TimelineClip): string {
  const text = clip.textProperties;
  if (!text) {
    return 'none';
  }

  const ctx = createMeasureContext(clip);
  const canvas = clip.source?.textCanvas;
  if (!ctx) {
    return 'unavailable';
  }

  const layout = createTextLayoutSnapshot(
    ctx,
    text,
    canvas?.width ?? 1920,
    canvas?.height ?? 1080,
  );
  const lines = layout.lines.slice(0, MAX_TEXT_LAYOUT_LINES).map((line) => (
    `  - ${line.index}: text=${formatQuoted(line.text, MAX_TEXT_PREVIEW_CHARS)} chars=${line.start}-${line.end} x=${Math.round(line.left)}-${Math.round(line.right)} y=${Math.round(line.y)} width=${Math.round(line.width)}`
  ));
  const omitted = layout.lines.length > lines.length
    ? [`  - ... ${layout.lines.length - lines.length} more lines omitted`]
    : [];
  const characters = layout.characters.slice(0, MAX_TEXT_LAYOUT_CHARACTERS).map((character) => (
    `  - ${character.index}: char=${formatQuoted(character.char, 16)} line=${character.lineIndex} rect=${Math.round(character.left)},${Math.round(character.top)},${Math.round(character.width)},${Math.round(character.height)}`
  ));
  const omittedCharacters = layout.characters.length > characters.length
    ? [`  - ... ${layout.characters.length - characters.length} more characters omitted`]
    : [];

  return [
    `canvas=${layout.canvasWidth}x${layout.canvasHeight} lineHeight=${Number(layout.lineHeightPx.toFixed(2))}`,
    layout.box ? `box=${Math.round(layout.box.x)},${Math.round(layout.box.y)},${Math.round(layout.box.width)},${Math.round(layout.box.height)}` : 'box=none',
    `contentBounds=${Math.round(layout.contentBounds.x)},${Math.round(layout.contentBounds.y)},${Math.round(layout.contentBounds.width)},${Math.round(layout.contentBounds.height)}`,
    'lines:',
    ...lines,
    ...omitted,
    `characters=${layout.characters.length} (full list is available at runtime as context.text.layout.characters; each has rect=[x,y,width,height])`,
    ...characters,
    ...omittedCharacters,
  ].join('\n');
}

function buildTextSourceContext(clip: TimelineClip): string | null {
  const text = clip.textProperties;
  if (!text) {
    return null;
  }

  const canvas = clip.source?.textCanvas;
  return [
    'Text source:',
    `- text=${formatQuoted(text.text, MAX_TEXT_CONTEXT_CHARS)}`,
    `- canvas=${canvas ? `${canvas.width}x${canvas.height}` : 'unknown'}`,
    `- fontFamily=${text.fontFamily}`,
    `- fontSize=${text.fontSize}`,
    `- fontWeight=${text.fontWeight}`,
    `- fontStyle=${text.fontStyle}`,
    `- color=${text.color}`,
    `- align=${text.textAlign}/${text.verticalAlign}`,
    `- lineHeight=${text.lineHeight}`,
    `- letterSpacing=${text.letterSpacing}`,
    `- box=${text.boxEnabled === true ? `${text.boxX ?? 0},${text.boxY ?? 0},${text.boxWidth ?? 'auto'},${text.boxHeight ?? 'auto'}` : 'disabled'}`,
    `- textBounds=${formatTextBounds(clip)}`,
    `- layout:\n${formatTextLayout(clip)}`,
    `- stroke=${text.strokeEnabled ? `${text.strokeColor}/${text.strokeWidth}` : 'disabled'}`,
    `- shadow=${text.shadowEnabled ? `${text.shadowColor}/${text.shadowOffsetX},${text.shadowOffsetY}/${text.shadowBlur}` : 'disabled'}`,
  ].join('\n');
}

function buildTimelineContext(clip: TimelineClip, context?: AINodeAuthoringProjectContext): string {
  const clips = context?.clips ?? [clip];
  const tracks = context?.tracks ?? [];
  const tracksById = new Map(tracks.map((track) => [track.id, track]));
  const visibleClips = clips
    .slice()
    .sort((a, b) => a.startTime - b.startTime)
    .slice(0, MAX_CONTEXT_CLIPS);

  return [
    `Tracks: ${tracks.map((track) => `${track.id}:${track.name}:${track.type}`).join(', ') || 'unknown'}`,
    'Timeline clips:',
    ...visibleClips.map((candidate) => formatClip(candidate, tracksById, clip.id)),
    clips.length > visibleClips.length ? `- ... ${clips.length - visibleClips.length} more clips omitted` : '',
  ].filter(Boolean).join('\n');
}

function buildGraphContext(graph: NodeGraph, definition: ClipCustomNodeDefinition): string {
  const selectedNode = graph.nodes.find((node) => node.id === definition.id);
  const nodes = graph.nodes.slice(0, MAX_CONTEXT_NODES);
  const edges = graph.edges.slice(0, MAX_CONTEXT_EDGES);
  const directEdges = getDirectEdges(graph, definition.id);

  return [
    'Current node:',
    selectedNode ? formatNode(selectedNode) : `- ${definition.id} (not projected)`,
    '',
    'Direct connections:',
    directEdges.length > 0 ? directEdges.map(formatEdge).join('\n') : '- none',
    '',
    'Graph nodes:',
    ...nodes.map(formatNode),
    graph.nodes.length > nodes.length ? `- ... ${graph.nodes.length - nodes.length} more nodes omitted` : '',
    '',
    'Graph edges:',
    edges.length > 0 ? edges.map(formatEdge).join('\n') : '- none',
    graph.edges.length > edges.length ? `- ... ${graph.edges.length - edges.length} more edges omitted` : '',
  ].filter(Boolean).join('\n');
}

export function buildAINodeAuthoringContext(
  clip: TimelineClip,
  definition: ClipCustomNodeDefinition,
  context?: AINodeAuthoringProjectContext,
): string {
  const graph = buildClipNodeGraph(clip);

  return [
    'MASTERSELECTS AI NODE AUTHORING CONTEXT',
    '',
    'Runtime capabilities:',
    '- custom node params support number, boolean, string, select, and color',
    '- color params use hex strings like "#008cff" at runtime and are keyframed internally through RGB channels',
    '',
    'Clip:',
    `- id=${clip.id}`,
    `- name="${clip.name}"`,
    `- source=${clip.source?.type ?? 'unknown'}`,
    `- file="${clip.file?.name ?? 'unknown'}"`,
    `- duration=${clip.duration}`,
    `- inPoint=${clip.inPoint}`,
    `- outPoint=${clip.outPoint}`,
    '',
    buildTextSourceContext(clip),
    '',
    buildTimelineContext(clip, context),
    '',
    buildGraphContext(graph, definition),
    '',
    'Authoring memory:',
    `- currentStatus=${definition.status}`,
    `- bypassed=${definition.bypassed === true}`,
    `- savedPlan=${definition.ai.plan?.trim() || 'none'}`,
    `- generatedCodePresent=${!!definition.ai.generatedCode?.trim()}`,
    `- exposedParams=${formatCustomParamSchema(definition)}`,
    `- conversationSummary=${definition.ai.conversationSummary?.trim() || 'none'}`,
  ].join('\n');
}
