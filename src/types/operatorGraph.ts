import type { NodePortContract } from './nodePortContract';
/** Durable operator contracts. Values and artifacts belong to the owner; bindings never copy them. */
export type OperatorValue = number | boolean | string | [number, number] | [number, number, number] | [number, number, number, number];
export type OperatorSignal = 'audio' | 'image' | 'uint32-texture' | 'pal-signal' | 'receiver-lines' | 'nearest-seed-field' | 'rgb' | 'alpha' | 'mask' | 'vec2' | 'vec3' | 'vec4' | 'texture' | 'uv' | 'material' | 'geometry' | 'primitive-mesh' | 'landmarks' | 'anchors' | 'depth' | 'surface' | 'force' | 'drag' | 'curves' | 'scene' | 'number' | 'boolean' | 'camera' | 'light' | 'field';
export interface OperatorPort { id: string; label: string; type: OperatorSignal; required?: boolean; repeated?: boolean; contract?: Partial<NodePortContract> }
export interface OperatorParameter {
  id: string; label: string; type: 'number' | 'boolean' | 'vector' | 'select' | 'color'; default: OperatorValue;
  min?: number; max?: number; step?: number; animatable?: boolean;
  /** Optional durable value semantics. Omitted means the registry has not declared them. */
  unit?: string;
  format?: string;
  options?: readonly { value: string; label: string }[];
}
export interface OperatorDefinition {
  id: string; version: 1; label: string; description: string;
  inputs: OperatorPort[]; outputs: OperatorPort[]; parameters: OperatorParameter[];
  invalidates: 'analysis' | 'simulation' | 'appearance';
  runtime: 'builtin' | 'worker'; bypass?: 'mute' | 'passthrough'; addable?: boolean;
  /** Execution facts consumed by catalogs and compilers; omitted legacy values are inferred by their owner. */
  state?: 'stateless' | 'frame-history' | 'simulation' | 'baked';
  fusion?: 'inline' | 'pass-boundary' | 'none';
  family?: string; variant?: string;
  /** Same operation with positional port roles; the owner supplies executable variants. */
  adaptivePorts?: boolean;
  /** Explicit catalog metadata; absent values remain unknown rather than inferred from labels. */
  consumers?: readonly string[];
  implementation?: 'shared' | 'local' | 'unknown';
  /** Versioned, pure graph implementation. The image compiler expands this inline. */
  composition?: OperatorCompositionBody;
}
export interface OperatorEndpoint { nodeId: string; portId: string }
export interface OperatorCompositionBody {
  graph: EffectOperatorGraph;
  inputs: Record<string, OperatorEndpoint[]>;
  outputs: Record<string, OperatorEndpoint>;
}
export type OperatorBinding = string | [string, string, string] | { yaw: string; pitch: string };
export interface BoundOperatorNode {
  id: string; operator: string; bindings: Record<string, OperatorBinding>;
  operatorVersion?: 1;
  /** Clip-local literal inputs; animated/effect-owned values remain indirect bindings. */
  constants?: Record<string, OperatorValue>;
  /** Optional parameter backing the node's enable control, shared with the effect form. */
  enabled?: string; enabledDefault?: boolean; bypassed?: boolean;
  /** Stable identities/layout of an instance's interior, including migrated flat nodes. */
  composition?: OperatorCompositionInstance;
}
export interface OperatorCompositionInstance {
  nodeIds: Record<string, string>;
  layout: EffectOperatorGraph['layout'];
  /** Preserve original leaf identities/layout through nested pack/expand cycles. */
  children?: Record<string, OperatorCompositionInstance>;
}
export interface OperatorEdge { id: string; from: string; output: string; to: string; input: string }
export interface EffectOperatorGraph {
  version: 1;
  schemaVersion?: 1;
  /** Applied exact composition migration revision; local ungrouping is not undone on every read. */
  compositionRules?: 1 | 2;
  /** Color compositions migrate independently so existing coordinate migration remains stable. */
  colorCompositionRules?: 1;
  /** An editable graph whose execution is paused until its missing wiring is repaired. */
  incomplete?: string;
  domain?: 'cables' | 'scene' | 'voxel' | 'image' | 'compute-image' | 'analog-signal' | 'audio';
  nodes: BoundOperatorNode[]; edges: OperatorEdge[];
  layout: Record<string, { x: number; y: number }>;
  groups?: OperatorGroup[];
}
export interface OperatorGroup {
  id: string; label: string; color: string; nodeIds: string[]; parentId?: string;
  collapsedByDefault?: boolean;
  /** Expanded editor view of a shared instance; repacked before persistence. */
  composition?: { instance: BoundOperatorNode; position: { x: number; y: number } };
}
/** Serializable clip-local scene graph. GPU resources remain owned by the renderer. */
export interface SceneOperatorGraph { graph: EffectOperatorGraph; params: Record<string, OperatorValue> }
export type ScenePrimitiveShape = 'box' | 'sphere' | 'cylinder';
export interface SceneSurfacePlan {
  visible: boolean; geometry: 'source' | 'plane' | 'primitive'; primitiveShape?: ScenePrimitiveShape; applyClipTransform: boolean;
  width: number; height: number; textured: boolean;
  uv: [number, number, number, number]; tint: [number, number, number]; opacity: number;
}
