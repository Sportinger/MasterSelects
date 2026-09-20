import type { TimelineSourceType } from './index';
import type { ColorNodeType } from './colorCorrection';
import type { NodePortContract } from './nodePortContract';

export type NodeGraphSignalType =
  | 'texture'
  | 'audio'
  | 'geometry'
  | 'point-cloud'
  | 'mesh'
  | 'table'
  | 'document'
  | 'vector'
  | 'curve'
  | 'mask'
  | 'text'
  | 'metadata'
  | 'event'
  | 'time'
  | 'scene'
  | 'timeline'
  | 'render-target'
  | 'binary'
  | 'number'
  | 'boolean'
  | 'string';

export type NodeGraphPortDirection = 'input' | 'output';

export type NodeGraphAudioSemanticKind =
  | 'audio-source'
  | 'waveform'
  | 'spectrum'
  | 'frequency-bands'
  | 'loudness'
  | 'beats'
  | 'onsets'
  | 'phase-correlation'
  | 'transcript'
  | 'frequency-summary'
  | 'audio-metadata';

export interface NodeGraphPortMetadata {
  animationProperty?: string;
  sourceArtifact?: { kind: 'face-landmarks' | 'scene-depth'; effectId?: string };
  artifactTarget?: { effectId: string; nodeId: string; portId: string };
  contract?: NodePortContract;
  groupEndpoint?: { nodeId: string; portId: string };
  semanticKind?: NodeGraphAudioSemanticKind | string;
  targetClipId?: string;
  signalRefId?: string;
  artifactId?: string;
  artifactProvenance?: 'source' | 'processed';
  artifactIndex?: number;
  available?: boolean;
  stale?: boolean;
  previewable?: boolean;
  /** Flock domain: connection requires an input (validation marks it when missing). */
  required?: boolean;
  /** Flock domain: input accepts several edges, evaluated in definition edge order. */
  repeated?: boolean;
  generateAction?: {
    type: string;
    artifactKind?: string;
    label?: string;
  };
}

export interface NodeGraphPort {
  id: string;
  label: string;
  type: NodeGraphSignalType;
  direction: NodeGraphPortDirection;
  metadata?: NodeGraphPortMetadata;
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

export type NodeGraphDomain =
  | 'clip'
  | 'color'
  | 'motion'
  | 'audio'
  | 'custom'
  | 'flock';

export type NodeGraphViewTheme = 'general' | 'color' | 'motion' | 'audio' | 'flock' | `effect:${string}`;

export type SceneNodeRole = 'geometry' | 'material' | 'transform' | 'render' | 'depth' | 'camera' | 'light' | 'splat-effector';

export type NodeGraphNodeBinding =
  | { kind: 'keyframe-node'; nodeId: string }
  | { kind: 'scene-operator'; nodeId: string; operator: string }
  | { kind: 'operator-group'; groupId: string; effectId?: string }
  | { kind: 'scene-node'; clipId: string; nodeId: string; role: SceneNodeRole; effectId?: string }
  | { kind: 'effect-operator'; effectId: string; nodeId: string; operator: string }
  | { kind: 'clip-source' }
  | { kind: 'clip-transform' }
  | { kind: 'clip-mask-stack' }
  | { kind: 'clip-color-correction' }
  | { kind: 'clip-effect'; effectId: string }
  | { kind: 'clip-audio-effect-instance'; effectId: string }
  | { kind: 'clip-audio-analysis' }
  | { kind: 'clip-custom-node'; nodeId: string }
  | { kind: 'clip-output' }
  | { kind: 'clip-audio-output' }
  | {
      kind: 'color-node';
      versionId: string;
      nodeId: string;
      nodeType: ColorNodeType;
    }
  | {
      kind: 'flock-node';
      nodeId: string;
      operator: string;
    };

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
  domain?: NodeGraphDomain;
  binding?: NodeGraphNodeBinding;
  subgraphId?: string;
  operatorId?: string;
  groupId?: string;
  groupOffset?: NodeGraphLayout;
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
  domain?: NodeGraphDomain;
  groups?: Array<{ id: string; label: string; color: string; collapsed: boolean; nodeIds: string[]; proxyId: string; parentId?: string }>;
  /** Uncollapsed nodes used to resolve exposed ports of nested groups. */
  expandedNodes?: NodeGraphNode[];
}

export interface NodeGraphView {
  id: string;
  theme: NodeGraphViewTheme;
  label: string;
  graphId: string;
}

export interface NodeGraphDocument {
  id: string;
  owner: NodeGraphOwner;
  rootGraphId: string;
  graphs: NodeGraph[];
  views: NodeGraphView[];
}

export type ClipNodeGraphBacking = Exclude<NodeGraphNodeBinding, { kind: 'color-node' } | { kind: 'flock-node' } | { kind: 'effect-operator' } | { kind: 'scene-node' } | { kind: 'scene-operator' } | { kind: 'operator-group' }>;

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
  keyframeNodes?: import('./keyframeNode').KeyframeNodeDefinition[];
  scene?: import('./operatorGraph').SceneOperatorGraph;
  nodes: ClipNodeGraphNodeState[];
  customNodes?: ClipCustomNodeDefinition[];
  forcedBuiltIns?: ClipNodeGraphForcedBuiltIn[];
  manualEdges?: NodeGraphEdge[];
  updatedAt?: number;
  groups?: Record<string, { collapsed?: boolean; position?: NodeGraphLayout; nodeLayouts?: Record<string, NodeGraphLayout> }>;
}
