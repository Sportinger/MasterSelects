import type { NodeGraphNode, NodeGraphPort } from '../../types/nodeGraph';

/** Runtime-only drawing messages. None of these resources enter project/history state. */
export type PreviewDrawing =
  | { kind: 'material'; color: number[]; opacity: number; textured: boolean }
  | { kind: 'text'; lines: string[] }
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
}

export interface PreviewRequest {
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
