import type { Effect } from './effects';
import type { Keyframe } from './keyframes';

/** Composition-owned executable graph. Timeline outputs only refer to this document. */
export interface SharedSceneGraph {
  id: string;
  name: string;
  effect: Effect;
  sourceClipId: string;
  startTime: number;
  outputs: Record<string, string[]>;
  /** Scan alignment; each published output adds its own local transform. */
  transform?: import('./timelineCore').ClipTransform;
  keyframes: Keyframe[];
}

export type SharedSceneGraphs = Record<string, SharedSceneGraph>;

export interface SceneGraphOutput {
  graphId: string;
  /** Missing on the original output, which renders all unassigned branches. */
  nodeIds?: string[];
  groupId?: string;
  label: string;
}
