import type { NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';

/** Runtime-only drawing messages. None of these resources enter project/history state. */
export type PreviewDrawing =
  | { kind: 'material'; color: number[]; opacity: number; textured: boolean }
  | { kind: 'text'; lines: string[] }
  | { kind: 'number'; value: string; caption: string; details?: string[] }
  | { kind: 'plot'; values: number[]; cursor?: number; bipolar?: boolean }
  | { kind: 'points'; points: number[]; edges?: number[]; dimensions: 2 | 3 }
  | { kind: 'depth'; values: number[]; width: number; height: number };

export interface PreviewFrame {
  key: string;
  revision: string;
  time: number;
  status: 'live' | 'saved' | 'stale' | 'missing' | 'error';
  label: string;
  bitmap?: ImageBitmap;
  aspectRatio?: number;
  drawing?: PreviewDrawing;
  /** Text/value viewers draw directly in the canvas, without atlas tiles. */
  presentation?: 'text';
  controls?: PreviewValueControl[];
  /** Read-only sampled values, alongside editable unconnected operands. */
  values?: Array<{ portId: string; direction: 'input' | 'output'; value?: number }>;
}

export interface PreviewValueControl {
  label: string; value: number | boolean | string; defaultValue: number | boolean | string; min?: number; max?: number; step?: number;
  /** Runtime display metadata resolved from the owning catalog; never persisted in the graph. */
  options?: readonly { value: string; label: string }[];
  /** Shares editor-local numeric preferences with another view of this value. */
  persistenceKey?: string;
  target: { clipId: string; effectId: string; nodeId: string; parameter: string; storage?: 'constant' }
    | { kind: 'flock'; clipId: string; nodeId: string; parameter: string };
  portId?: string;
  direction?: 'input' | 'output';
}

export interface PreviewRequest {
  /** Numeric values bypass the image readback queue and pixel budget. */
  numeric?: boolean;
  key: string;
  revision: string;
  clipId: string;
  /** Stable across normal playback, changes for edits, seeks and output selection. */
  continuity?: string;
  colorNodeIds?: string[];
  node: NodeGraphNode;
  port?: NodeGraphPort;
  time: number;
  width: number;
  height: number;
  interval: number;
  priority: number;
}

export function releasePreviewFrame(frame: PreviewFrame | undefined) { frame?.bitmap?.close(); }

export function previewOutput(node: NodeGraphNode, portId?: string): NodeGraphPort | undefined {
  return node.outputs.find(port => port.id === portId) ?? node.outputs[0] ?? node.inputs.find(port => port.id === portId) ?? node.inputs[0];
}

/** Viewer choices follow the saved node across focused and unified views. */
export function nodePreviewPreferenceKey(clipId: string, node: NodeGraphNode): string {
  const binding = node.binding;
  if (binding?.kind === 'color-node') return `clip-graph:${clipId}:color:${binding.versionId}/${binding.nodeId}`;
  if (binding?.kind === 'flock-node') return `clip-graph:${clipId}:flock/${binding.nodeId}`;
  return node.id;
}

/** Identical source viewers share a single snapshot and worker resource. */
export function nodePreviewKey(clipId: string, node: NodeGraphNode, portId?: string): string {
  const port = previewOutput(node, portId), binding = node.binding;
  const source = binding?.kind === 'clip-source' || (binding?.kind === 'effect-operator' && binding.operator === 'media.source')
    || (binding?.kind === 'scene-operator' && binding.operator === 'image.frame');
  if (source && port?.type === 'texture' && !port.metadata?.sourceArtifact && (!port.metadata?.semanticKind || port.metadata.semanticKind === 'operator:image')) return JSON.stringify([clipId, 'source-image']);
  if (binding?.kind === 'color-node' && port?.type === 'texture') {
    if (binding.nodeType === 'input' || binding.nodeType === 'output') return JSON.stringify([clipId, 'color', binding.nodeType]);
    return JSON.stringify([clipId, 'color', binding.nodeId, port.id]);
  }
  if (binding?.kind === 'clip-color-correction') return JSON.stringify([clipId, 'color', 'output']);
  return JSON.stringify([clipId, node.id, port?.id]);
}
