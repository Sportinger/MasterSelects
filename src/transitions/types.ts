// Transition Types
// Defines the structure for timeline transitions between clips

export type TransitionType = 'crossfade' | 'dip-to-black' | 'dip-to-white' | 'wipe-left' | 'wipe-right';

/**
 * Transition definition - each transition type implements this interface
 */
export interface TransitionDefinition {
  /** Unique identifier for this transition type */
  id: TransitionType;

  /** Display name shown in UI */
  name: string;

  /** Category for grouping in panel */
  category: TransitionCategory;

  /** Icon name (Lucide icon) */
  icon: string;

  /** Default duration in seconds */
  defaultDuration: number;

  /** Minimum duration in seconds */
  minDuration: number;

  /** Maximum duration in seconds */
  maxDuration: number;

  /** Description shown in tooltip */
  description: string;

  /**
   * Generate keyframes for the outgoing clip (clip A)
   * @param duration - Transition duration in seconds
   * @returns Array of keyframe definitions { time, property, value }
   */
  getOutgoingKeyframes: (duration: number) => TransitionKeyframe[];

  /**
   * Generate keyframes for the incoming clip (clip B)
   * @param duration - Transition duration in seconds
   * @returns Array of keyframe definitions { time, property, value }
   */
  getIncomingKeyframes: (duration: number) => TransitionKeyframe[];
}

export type TransitionCategory = 'dissolve' | 'wipe' | 'slide' | 'zoom';

/**
 * Keyframe definition for transition animation
 */
export interface TransitionKeyframe {
  /** Time relative to transition start (0 = start, duration = end) */
  time: number;
  /** Property to animate */
  property: 'opacity' | 'position.x' | 'position.y' | 'scale.x' | 'scale.y';
  /** Value at this keyframe */
  value: number;
}

/**
 * Transition instance stored on a clip
 */
export interface ClipTransition {
  /** Unique ID for this transition instance */
  id: string;
  /** Type of transition */
  type: TransitionType;
  /** Duration in seconds */
  duration: number;
  /** ID of the other clip in the transition */
  linkedClipId: string;
}
