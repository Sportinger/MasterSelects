import type { SignalKind, SignalRuntimeKind, SignalGraphEdge } from '../signals/types';
import type { TimelineSourceType } from './index';
import type { ColorNodeType } from './colorCorrection';
import type { NodePortContract } from './nodePortContract';
import type { OperatorEndpoint, OperatorPort } from './operatorGraph';

export type NodeGraphSignalType = SignalKind;

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
  /** Recorded dependency, changed through its owning action rather than cable editing. */
  readOnly?: boolean;
  animationProperty?: string;
  controlProperty?: string;
  sourceArtifact?: { kind: 'face-landmarks' | 'scene-depth'; effectId?: string };
  artifactTarget?: { effectId: string; nodeId: string; portId: string };
  contract?: NodePortContract;
  groupEndpoint?: { nodeId: string; portId: string };
  groupEndpoints?: OperatorEndpoint[];
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

export type NodeGraphRuntimeKind = SignalRuntimeKind;

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
  | { kind: 'parameter-source'; nodeId: string }
  | { kind: 'clip-text'; stage: import('./text').TextNodeStage }
  | { kind: 'clip-stabilization'; stage: 'solve' | 'keyframes' }
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

/** Node editor cable drawing: bezier (default), orthogonal hard corners, or compact routed curves. */
export type NodeCableStyle = 'curved' | 'angular' | 'smart';

export interface NodeGraphLayout {
  x: number;
  y: number;
}

export interface NodeGraphControlInput {
  property: string;
  label: string;
  group: string;
  visible: boolean;
}

export interface NodeGraphNode {
  /** Transient executable alternatives supplied by the owning graph, never saved. */
  connectionVariants?: readonly NodeConnectionVariant[];
  /** Projected viewer presentation; preferences are stored on the owning clip. */
  preview?: { enabled: boolean; requested: boolean; portId?: string; key: string; aspectRatio?: number };
  /** Transient catalog of scalar inputs that the user may expose on this node. */
  controlInputs?: readonly NodeGraphControlInput[];
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
  animation?: {
    clipId: string;
    channels: Array<{ nodeId: string; channelId: string; property: import('./animationProperties').AnimatableProperty }>;
  };
}

export interface NodeGraphEdge {
  readOnly?: boolean;
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  type: NodeGraphSignalType;
}

export type NodeGraphConnectionRequest = Pick<SignalGraphEdge, 'fromNodeId' | 'fromPortId' | 'toNodeId' | 'toPortId'>;

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
  issue?: string;
  groups?: Array<{ id: string; label: string; color: string; collapsed: boolean; nodeIds: string[]; proxyId: string; parentId?: string; bypassNodeId?: string; effectId?: string; bypassed?: boolean; issue?: string;
    collapsedByDefault?: boolean; layoutMode?: 'flow';
    /** Free-standing effect group outside the clip chain; the outer layout leaves it where it was placed. */
    detached?: boolean;
    /** Effect group without nodes besides its clip input/output: its frame can be sized by hand. */
    resizable?: boolean;
    /** Saved frame size of a still empty effect group; its members still enlarge it. */
    size?: NodeGroupSize;
    composition?: { operatorId: string; description: string; position: NodeGraphLayout; inputs: Array<OperatorPort & { endpoints: OperatorEndpoint[] }>; outputs: Array<OperatorPort & { endpoints: OperatorEndpoint[] }> } }>;
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

/** Presentation coordinates, independent of executable domain layouts. */
/** Presentation-only cable branch point: every connection still runs output → input. */
export interface NodeCableBranch {
  nodeId: string;
  portId: string;
  /** Branch point this one continues from; otherwise the output socket. */
  parentId?: string;
  x: number;
  y: number;
  /** Input sockets whose cables leave from this point. */
  targets: Array<{ nodeId: string; portId: string }>;
}

export interface NodeCanvasPlacement {
  /** Wrap top-level effects into compact rows; defaults to enabled. */
  compactEffects?: boolean;
  /** Cable branch points, keyed by id. Layout data: never read by rendering or export. */
  branches?: Record<string, NodeCableBranch>;
  /** Outer flow chains have been compacted, including legacy saved anchors. */
  flowLayoutVersion?: 1;
  nodes: Record<string, NodeGraphLayout>;
  /** User moves are anchors; computed positions follow topology and fold changes. */
  pinned?: Record<string, true>;
  /** Reversible displacement caused by expanded frames, independent of manual anchors. */
  displaced?: Record<string, { origin: NodeGraphLayout; groups: string[] }>;
  groups: Record<string, { nodeIds: string[]; proxyId: string; parentId?: string; offset: NodeGraphLayout; locked?: boolean; collapsed?: boolean }>;
}

export interface NodeConnectionVariant {
  operatorId: string;
  inputs: readonly NodeGraphPort[];
  outputs: readonly NodeGraphPort[];
}

/** A cable released on the canvas, before choosing its new endpoint. */
export interface NodeConnectionDrop {
  nodeId: string;
  portId: string;
  direction: 'input' | 'output';
  x: number;
  y: number;
  layout: NodeGraphLayout;
}

export interface ClipNodeGraph {
  version: 1;
  canvasPlacements?: Record<string, NodeCanvasPlacement>;
  previews?: { enabled: boolean; nodes: Record<string, { enabled: boolean; portId?: string }> };
  stabilization?: import('./faceStabilization').ClipStabilizationGraph;
  keyframeNodes?: import('./keyframeNode').KeyframeNodeDefinition[];
  parameterSources?: import('./parameterSources').ParameterSources;
  scene?: import('./operatorGraph').SceneOperatorGraph;
  nodes: ClipNodeGraphNodeState[];
  customNodes?: ClipCustomNodeDefinition[];
  forcedBuiltIns?: ClipNodeGraphForcedBuiltIn[];
  manualEdges?: NodeGraphEdge[];
  updatedAt?: number;
  groups?: Record<string, { collapsed?: boolean; position?: NodeGraphLayout; nodeLayouts?: Record<string, NodeGraphLayout>; size?: NodeGroupSize }>;
}

/** Canvas frame size of an empty effect group, in workspace units. */
export interface NodeGroupSize { width: number; height: number }
