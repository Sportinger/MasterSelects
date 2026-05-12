import type { TimelineSourceType } from './index';

export type NodeGraphSignalType =
  | 'texture'
  | 'audio'
  | 'geometry'
  | 'curve'
  | 'mask'
  | 'text'
  | 'metadata'
  | 'event'
  | 'time'
  | 'scene'
  | 'timeline'
  | 'render-target'
  | 'number'
  | 'boolean'
  | 'string';

export type NodeGraphPortDirection = 'input' | 'output';

export interface NodeGraphPort {
  id: string;
  label: string;
  type: NodeGraphSignalType;
  direction: NodeGraphPortDirection;
}

export type NodeGraphNodeKind =
  | 'source'
  | 'transform'
  | 'mask'
  | 'color'
  | 'effect'
  | 'motion'
  | 'analysis'
  | 'custom'
  | 'output';

export type NodeGraphRuntimeKind =
  | 'builtin'
  | 'typescript'
  | 'wgsl'
  | 'worker'
  | 'wasm'
  | 'native'
  | 'subgraph';

export interface NodeGraphLayout {
  x: number;
  y: number;
}

export interface NodeGraphNode {
  id: string;
  kind: NodeGraphNodeKind;
  runtime: NodeGraphRuntimeKind;
  label: string;
  description?: string;
  sourceType?: TimelineSourceType;
  inputs: NodeGraphPort[];
  outputs: NodeGraphPort[];
  params?: Record<string, string | number | boolean>;
  layout: NodeGraphLayout;
}

export interface NodeGraphEdge {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  type: NodeGraphSignalType;
}

export interface NodeGraphOwner {
  kind: 'clip';
  id: string;
  name: string;
}

export interface NodeGraph {
  id: string;
  owner: NodeGraphOwner;
  nodes: NodeGraphNode[];
  edges: NodeGraphEdge[];
}

export type ClipNodeGraphBacking =
  | { kind: 'clip-source' }
  | { kind: 'clip-transform' }
  | { kind: 'clip-mask-stack' }
  | { kind: 'clip-color-correction' }
  | { kind: 'clip-effect'; effectId: string }
  | { kind: 'clip-custom-node'; nodeId: string }
  | { kind: 'clip-output' }
  | { kind: 'clip-audio-output' };

export interface ClipNodeGraphNodeState {
  id: string;
  backing: ClipNodeGraphBacking;
  layout: NodeGraphLayout;
}

export type ClipCustomNodeAuthoringStatus = 'draft' | 'ready';

export interface ClipCustomNodeAIAuthoring {
  prompt: string;
  generatedCode?: string;
  updatedAt?: number;
  acceptedAt?: number;
}

export interface ClipCustomNodeDefinition {
  id: string;
  label: string;
  description?: string;
  runtime: Exclude<NodeGraphRuntimeKind, 'builtin'>;
  status: ClipCustomNodeAuthoringStatus;
  inputs: NodeGraphPort[];
  outputs: NodeGraphPort[];
  params?: Record<string, string | number | boolean>;
  ai: ClipCustomNodeAIAuthoring;
}

export type ClipNodeGraphForcedBuiltIn = 'transform' | 'mask' | 'color';

export interface ClipNodeGraph {
  version: 1;
  nodes: ClipNodeGraphNodeState[];
  customNodes?: ClipCustomNodeDefinition[];
  forcedBuiltIns?: ClipNodeGraphForcedBuiltIn[];
  updatedAt?: number;
}
