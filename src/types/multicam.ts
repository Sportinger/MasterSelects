// Multicam editing on a normal composition: one video track per camera ("angle").
// The descriptor remembers every angle's full-length source clips, so any camera
// can be cut back in for any range after it was removed from the program.

import type { Effect } from './effects';
import type { ClipMask } from './masks';
import type { ClipTransform } from './timelineCore';

/** Serializable look of the original clip, applied to every program piece of the source. */
export interface MulticamClipTemplate {
  name: string;
  transform: ClipTransform;
  effects: Effect[];
  masks?: ClipMask[];
}

export interface MulticamAngleSource {
  mediaFileId: string;
  /** Timeline position of the full source clip. */
  startTime: number;
  inPoint: number;
  duration: number;
  template: MulticamClipTemplate;
}

export interface MulticamAngle {
  /** The video track that holds this angle's program pieces. */
  trackId: string;
  label: string;
  sources: MulticamAngleSource[];
}

export interface CompositionMulticam {
  version: 1;
  /** Cut mode is on: keys 1..n switch cameras and the Multi Preview shows the angles. */
  active: boolean;
  /** Manual link group of every synchronized clip in the composition. */
  groupId: string;
  /** Top to bottom; angle N is switched with key N. */
  angles: MulticamAngle[];
}
