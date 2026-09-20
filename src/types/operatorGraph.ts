/** Durable operator contracts. Values and artifacts belong to the owner; bindings never copy them. */
export type OperatorValue = number | boolean | string | [number, number, number];
export type OperatorSignal = 'image' | 'texture' | 'uv' | 'material' | 'geometry' | 'landmarks' | 'anchors' | 'depth' | 'surface' | 'force' | 'drag' | 'curves' | 'scene' | 'number';
export interface OperatorPort { id: string; label: string; type: OperatorSignal; required?: boolean; repeated?: boolean }
export interface OperatorParameter {
  id: string; label: string; type: 'number' | 'boolean' | 'vector'; default: OperatorValue;
  min?: number; max?: number; step?: number; animatable?: boolean;
}
export interface OperatorDefinition {
  id: string; version: 1; label: string; description: string;
  inputs: OperatorPort[]; outputs: OperatorPort[]; parameters: OperatorParameter[];
  invalidates: 'analysis' | 'simulation' | 'appearance';
  runtime: 'builtin' | 'worker'; bypass?: 'mute'; addable?: boolean;
}
export type OperatorBinding = string | [string, string, string] | { yaw: string; pitch: string };
export interface BoundOperatorNode {
  id: string; operator: string; bindings: Record<string, OperatorBinding>;
  /** Optional parameter backing the node's enable control, shared with the effect form. */
  enabled?: string; enabledDefault?: boolean; bypassed?: boolean;
}
export interface OperatorEdge { id: string; from: string; output: string; to: string; input: string }
export interface EffectOperatorGraph {
  version: 1;
  domain?: 'cables' | 'scene';
  nodes: BoundOperatorNode[]; edges: OperatorEdge[];
  layout: Record<string, { x: number; y: number }>;
  groups?: OperatorGroup[];
}
export interface OperatorGroup {
  id: string; label: string; color: string; nodeIds: string[]; parentId?: string;
}
/** Serializable clip-local scene graph. GPU resources remain owned by the renderer. */
export interface SceneOperatorGraph { graph: EffectOperatorGraph; params: Record<string, OperatorValue> }
export interface SceneSurfacePlan {
  visible: boolean; geometry: 'source' | 'plane'; applyClipTransform: boolean;
  width: number; height: number; textured: boolean;
  uv: [number, number, number, number]; tint: [number, number, number]; opacity: number;
}
