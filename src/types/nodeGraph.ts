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
  params?: Record<string, ClipCustomNodeParamValue>;
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

export interface NodeGraphConnectionRequest {
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
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

export type ClipCustomNodeConversationRole = 'user' | 'assistant';
export type ClipCustomNodeConversationKind = 'plan' | 'code' | 'message';

export type ClipCustomNodeParamValue = string | number | boolean;
export type ClipCustomNodeParamType = 'number' | 'boolean' | 'string' | 'select' | 'color';

export interface ClipCustomNodeParamOption {
  label: string;
  value: ClipCustomNodeParamValue;
}

export interface ClipCustomNodeParamDefinition {
  id: string;
  label: string;
  type: ClipCustomNodeParamType;
  default: ClipCustomNodeParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: ClipCustomNodeParamOption[];
}

export interface ClipCustomNodeConversationMessage {
  id: string;
  role: ClipCustomNodeConversationRole;
  kind: ClipCustomNodeConversationKind;
  content: string;
  createdAt: number;
}

export interface ClipCustomNodeAIAuthoring {
  prompt: string;
  plan?: string;
  generatedCode?: string;
  conversation?: ClipCustomNodeConversationMessage[];
  conversationSummary?: string;
  updatedAt?: number;
  acceptedAt?: number;
}

export interface ClipCustomNodeDefinition {
  id: string;
  label: string;
  description?: string;
  bypassed?: boolean;
  runtime: Exclude<NodeGraphRuntimeKind, 'builtin'>;
  status: ClipCustomNodeAuthoringStatus;
  inputs: NodeGraphPort[];
  outputs: NodeGraphPort[];
  params?: Record<string, ClipCustomNodeParamValue>;
  parameterSchema?: ClipCustomNodeParamDefinition[];
  ai: ClipCustomNodeAIAuthoring;
}

export type ClipNodeGraphForcedBuiltIn = 'transform' | 'mask' | 'color';

export interface ClipNodeGraph {
  version: 1;
  nodes: ClipNodeGraphNodeState[];
  customNodes?: ClipCustomNodeDefinition[];
  forcedBuiltIns?: ClipNodeGraphForcedBuiltIn[];
  manualEdges?: NodeGraphEdge[];
  updatedAt?: number;
}
