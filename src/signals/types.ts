export const SIGNAL_SCHEMA_VERSION = 1 as const;

export const SIGNAL_KINDS = [
  'texture',
  'audio',
  'geometry',
  'point-cloud',
  'mesh',
  'scene',
  'table',
  'document',
  'vector',
  'curve',
  'mask',
  'text',
  'metadata',
  'event',
  'time',
  'timeline',
  'render-target',
  'binary',
  'number',
  'boolean',
  'string',
] as const;

export type SignalKind = typeof SIGNAL_KINDS[number];

export const SIGNAL_RUNTIME_KINDS = [
  'builtin',
  'typescript',
  'wgsl',
  'worker',
  'wasm',
  'native',
  'subgraph',
] as const;

export type SignalRuntimeKind = typeof SIGNAL_RUNTIME_KINDS[number];

export type SignalProviderRole =
  | 'importer'
  | 'analyzer'
  | 'operator'
  | 'renderer-adapter'
  | 'exporter';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type SignalMetadata = Record<string, JsonValue>;

export interface SignalByteRange {
  offset: number;
  length: number;
}

export type SignalArtifactStorageKind =
  | 'project-cache'
  | 'indexeddb'
  | 'memory'
  | 'external';

export interface SignalArtifactStorage {
  kind: SignalArtifactStorageKind;
  projectRelativePath?: string;
  uri?: string;
}

export type SignalArtifactEncoding =
  | 'raw'
  | 'json'
  | 'text'
  | 'csv'
  | 'image-bitmap'
  | 'gpu-texture'
  | 'audio-buffer'
  | 'mesh-buffer'
  | 'table-records';

export interface SignalArtifactProducer {
  providerId: string;
  providerVersion?: string;
  jobId?: string;
}

export interface SignalArtifact {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  artifactId: string;
  hash: string;
  size: number;
  mimeType: string;
  encoding: SignalArtifactEncoding;
  storage: SignalArtifactStorage;
  producer: SignalArtifactProducer;
  sourceRefs: string[];
  createdAt: string;
  byteRange?: SignalByteRange;
  metadata?: SignalMetadata;
}

export interface SignalRef {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  id: string;
  kind: SignalKind;
  label?: string;
  assetId?: string;
  artifactId?: string;
  portId?: string;
  mimeType?: string;
  createdAt: string;
  metadata?: SignalMetadata;
}

export type SignalAssetSourceKind =
  | 'file'
  | 'generated'
  | 'operator'
  | 'node-graph'
  | 'timeline'
  | 'unknown';

export interface SignalAssetSource {
  kind: SignalAssetSourceKind;
  fileName?: string;
  extension?: string;
  mimeType?: string;
  size?: number;
  hash?: string;
  projectPath?: string;
  absolutePath?: string;
  providerId?: string;
}

export interface SignalAsset {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  id: string;
  name: string;
  source: SignalAssetSource;
  refs: SignalRef[];
  artifacts: SignalArtifact[];
  createdAt: string;
  updatedAt?: string;
  metadata?: SignalMetadata;
}

export interface SignalPortDescriptor {
  id: string;
  label: string;
  kind: SignalKind;
  required?: boolean;
  repeated?: boolean;
  metadata?: SignalMetadata;
}

export interface SignalOperatorDescriptor {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  id: string;
  version: string;
  label: string;
  role: SignalProviderRole;
  runtime: SignalRuntimeKind;
  inputs: SignalPortDescriptor[];
  outputs: SignalPortDescriptor[];
  deterministic?: boolean;
  stateful?: boolean;
  metadata?: SignalMetadata;
}

export interface SignalGraphNode {
  id: string;
  operatorId: string;
  label?: string;
  params?: SignalMetadata;
}

export interface SignalGraphEdge {
  id: string;
  fromNodeId: string;
  fromPortId: string;
  toNodeId: string;
  toPortId: string;
  kind: SignalKind;
}

export interface SignalGraphOwner {
  kind: 'asset' | 'clip' | 'composition' | 'project' | 'node-graph';
  id: string;
}

export interface SignalGraph {
  schemaVersion: typeof SIGNAL_SCHEMA_VERSION;
  id: string;
  owner?: SignalGraphOwner;
  nodes: SignalGraphNode[];
  edges: SignalGraphEdge[];
  outputs: SignalRef[];
  createdAt: string;
  updatedAt?: string;
  metadata?: SignalMetadata;
}
