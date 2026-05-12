import type { TimelineSourceType } from '../../types';

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
  layout: {
    x: number;
    y: number;
  };
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

