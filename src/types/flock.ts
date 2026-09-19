/**
 * Durable Flock Clip definitions.
 *
 * A flock clip (`source.type === 'flock'`) owns one versioned FlockDefinition:
 * an executable node graph whose Simulation node advances a particle swarm in
 * source time and whose render branches draw into the shared 3D scene.
 *
 * Everything here is plain JSON. GPU buffers, media elements, workers and
 * per-frame particle arrays live in runtime owners (src/engine/flock/), never
 * in clips, project data or history snapshots.
 */

export const FLOCK_DEFINITION_VERSION = 1 as const;

export type FlockVec3 = [number, number, number];

/** Colors are '#rrggbb'; enums and asset references are strings. */
export type FlockParamValue = number | boolean | string | FlockVec3;

export type FlockPortType =
  | 'spawn'
  | 'behavior'
  | 'obstacle'
  | 'boundary'
  | 'path'
  | 'particles'
  | 'curves'
  | 'selection'
  | 'scalar'
  | 'palette'
  | 'scene';

export interface FlockPortRef {
  nodeId: string;
  port: string;
}

export interface FlockEdge {
  id: string;
  from: FlockPortRef;
  to: FlockPortRef;
}

export interface FlockNode {
  /** Stable id without '.' so it can live inside property paths. */
  id: string;
  operator: string;
  operatorVersion: number;
  label?: string;
  params: Record<string, FlockParamValue>;
  bypassed?: boolean;
  /** Operator `flock.group`: id of the group definition this node instantiates. */
  groupRef?: string;
}

export interface FlockNodeLayout {
  x: number;
  y: number;
}

/** A clip-panel slider bound to one canonical node parameter. Stores no value. */
export interface FlockExposedParam {
  id: string;
  nodeId: string;
  param: string;
  label: string;
  group: string;
  order: number;
  min?: number;
  max?: number;
}

export interface FlockGroupPortBinding {
  id: string;
  label: string;
  type: FlockPortType;
  required?: boolean;
  /** Inner node port this boundary port forwards to (inputs) or from (outputs). */
  target: FlockPortRef;
}

/** Reusable compositional wrapper around registered flock operators. */
export interface FlockGroupDefinition {
  id: string;
  label: string;
  version: number;
  nodes: FlockNode[];
  edges: FlockEdge[];
  inputs: FlockGroupPortBinding[];
  outputs: FlockGroupPortBinding[];
  layout: Record<string, FlockNodeLayout>;
}

export type FlockLoopMode = 'none' | 'reset';

export interface FlockTimeSettings {
  /** 'reset' restarts the simulation at every loopSeconds of source time. */
  loop: FlockLoopMode;
  loopSeconds: number;
}

export interface FlockCacheSettings {
  /** Source-time range the user asked to precompute for reliable scrubbing. */
  precomputeStart: number;
  precomputeEnd: number;
  /** Persist restart checkpoints for the range so a reopened project can seek quickly. */
  persist: boolean;
}

export interface FlockDefinition {
  version: typeof FLOCK_DEFINITION_VERSION;
  presetId?: string;
  nodes: FlockNode[];
  edges: FlockEdge[];
  exposed: FlockExposedParam[];
  groups: FlockGroupDefinition[];
  /** Layout lives beside the graph so moving a node never invalidates simulation. */
  layout: Record<string, FlockNodeLayout>;
  time: FlockTimeSettings;
  cache?: FlockCacheSettings;
}

export type FlockDiagnosticSeverity = 'error' | 'warning' | 'info';

export interface FlockDiagnostic {
  code: string;
  severity: FlockDiagnosticSeverity;
  message: string;
  nodeIds?: string[];
  edgeIds?: string[];
}

/** Keyframe property path for flock node parameters (source-time basis). */
export type FlockProperty = `flock.node.${string}.${string}`;

export type FlockParamComponent = 'x' | 'y' | 'z' | 'r' | 'g' | 'b';

export interface ParsedFlockProperty {
  nodeId: string;
  param: string;
  component?: FlockParamComponent;
}

const FLOCK_PROPERTY_PATTERN = /^flock\.node\.([^.]+)\.([^.]+)(?:\.([xyzrgb]))?$/;

export function isFlockProperty(property: string): property is FlockProperty {
  return FLOCK_PROPERTY_PATTERN.test(property);
}

export function parseFlockProperty(property: string): ParsedFlockProperty | null {
  const match = FLOCK_PROPERTY_PATTERN.exec(property);
  if (!match) return null;
  return {
    nodeId: match[1],
    param: match[2],
    ...(match[3] ? { component: match[3] as FlockParamComponent } : {}),
  };
}

export function createFlockProperty(
  nodeId: string,
  param: string,
  component?: FlockParamComponent,
): FlockProperty {
  return (component
    ? `flock.node.${nodeId}.${param}.${component}`
    : `flock.node.${nodeId}.${param}`) as FlockProperty;
}
