import type { AnimatableProperty } from './animationProperties';
import type { NodeGraphLayout } from './nodeGraph';

/** A channel owns the existing timeline curve of its first parameter. */
export interface KeyframeNodeChannel {
  id: string;
  property: AnimatableProperty;
  targets: Array<{ property: AnimatableProperty; scale: number; offset: number }>;
}

/** Layout and bindings only. Keyframes stay in the timeline's keyframe map. */
export interface KeyframeNodeDefinition {
  id: string;
  label: string;
  layout: NodeGraphLayout;
  channels: KeyframeNodeChannel[];
}
