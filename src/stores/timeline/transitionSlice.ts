// Transition-related actions slice

import type { TransitionActions, SliceCreator, Keyframe } from './types';
import type { TimelineTransition, AnimatableProperty } from '../../types';
import { getTransition, type TransitionType } from '../../transitions';
import { Logger } from '../../services/logger';

const log = Logger.create('Transitions');

// Generate unique transition ID
const generateTransitionId = () => `transition-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

// Generate unique keyframe ID
const generateKeyframeId = () => `kf-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

export const createTransitionSlice: SliceCreator<TransitionActions> = (set, get) => ({
  /**
   * Apply a transition between two adjacent clips
   * Creates overlap by moving clipB earlier and adds opacity keyframes
   */
  applyTransition: (clipAId: string, clipBId: string, type: string, duration: number) => {
    const { clips, clipKeyframes, invalidateCache } = get();

    const clipA = clips.find(c => c.id === clipAId);
    const clipB = clips.find(c => c.id === clipBId);

    if (!clipA || !clipB) {
      log.warn('Cannot apply transition: clips not found', { clipAId, clipBId });
      return;
    }

    // Verify clips are on the same track
    if (clipA.trackId !== clipB.trackId) {
      log.warn('Cannot apply transition: clips on different tracks');
      return;
    }

    // Verify clipB comes after clipA
    if (clipB.startTime < clipA.startTime) {
      log.warn('Cannot apply transition: clipB must come after clipA');
      return;
    }

    // Get transition definition
    const transitionDef = getTransition(type as TransitionType);
    if (!transitionDef) {
      log.warn('Unknown transition type', { type });
      return;
    }

    // Clamp duration to valid range
    const effectiveDuration = Math.min(
      Math.max(duration, transitionDef.minDuration),
      Math.min(transitionDef.maxDuration, clipA.duration, clipB.duration)
    );

    // Calculate new positions
    // Move clipB's start earlier to create overlap
    const clipAEnd = clipA.startTime + clipA.duration;
    const newClipBStart = clipAEnd - effectiveDuration;

    // Create transition objects
    const transitionId = generateTransitionId();

    const transitionOut: TimelineTransition = {
      id: transitionId,
      type,
      duration: effectiveDuration,
      linkedClipId: clipBId,
    };

    const transitionIn: TimelineTransition = {
      id: transitionId,
      type,
      duration: effectiveDuration,
      linkedClipId: clipAId,
    };

    // Generate keyframes for the transition
    const outgoingKeyframes = transitionDef.getOutgoingKeyframes(effectiveDuration);
    const incomingKeyframes = transitionDef.getIncomingKeyframes(effectiveDuration);

    // Convert to store keyframes
    // ClipA keyframes: at the END of the clip
    const clipATransitionStart = clipA.duration - effectiveDuration;
    const newClipAKeyframes: Keyframe[] = outgoingKeyframes.map(kf => ({
      id: generateKeyframeId(),
      clipId: clipAId,
      time: clipATransitionStart + kf.time,
      property: kf.property as AnimatableProperty,
      value: kf.value,
      easing: 'linear',
    }));

    // ClipB keyframes: at the START of the clip
    const newClipBKeyframes: Keyframe[] = incomingKeyframes.map(kf => ({
      id: generateKeyframeId(),
      clipId: clipBId,
      time: kf.time,
      property: kf.property as AnimatableProperty,
      value: kf.value,
      easing: 'linear',
    }));

    // Merge keyframes into existing keyframes
    const updatedKeyframes = new Map(clipKeyframes);

    // Add clipA keyframes (preserve existing non-transition keyframes)
    const existingClipAKeyframes = updatedKeyframes.get(clipAId) || [];
    const clipAKeyframesFiltered = existingClipAKeyframes.filter(kf =>
      // Remove any existing opacity keyframes in the transition zone
      !(kf.property === 'opacity' && kf.time >= clipATransitionStart)
    );
    updatedKeyframes.set(clipAId, [...clipAKeyframesFiltered, ...newClipAKeyframes]);

    // Add clipB keyframes
    const existingClipBKeyframes = updatedKeyframes.get(clipBId) || [];
    const clipBKeyframesFiltered = existingClipBKeyframes.filter(kf =>
      // Remove any existing opacity keyframes in the transition zone
      !(kf.property === 'opacity' && kf.time <= effectiveDuration)
    );
    updatedKeyframes.set(clipBId, [...clipBKeyframesFiltered, ...newClipBKeyframes]);

    // Update clips with new positions and transition data
    set({
      clips: clips.map(c => {
        if (c.id === clipAId) {
          return { ...c, transitionOut };
        }
        if (c.id === clipBId) {
          return { ...c, startTime: newClipBStart, transitionIn };
        }
        return c;
      }),
      clipKeyframes: updatedKeyframes,
    });

    invalidateCache();
    log.info('Applied transition', { type, duration: effectiveDuration, clipA: clipA.name, clipB: clipB.name });
  },

  /**
   * Remove a transition from a clip
   */
  removeTransition: (clipId: string, edge: 'in' | 'out') => {
    const { clips, clipKeyframes, invalidateCache } = get();

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut;
    if (!transition) return;

    const linkedClip = clips.find(c => c.id === transition.linkedClipId);
    const duration = transition.duration;

    // Remove transition keyframes
    const updatedKeyframes = new Map(clipKeyframes);

    // Remove keyframes from this clip
    const thisClipKeyframes = updatedKeyframes.get(clipId) || [];
    if (edge === 'in') {
      // Remove keyframes at the start
      updatedKeyframes.set(clipId, thisClipKeyframes.filter(kf =>
        !(kf.property === 'opacity' && kf.time <= duration)
      ));
      // Move clip back to non-overlapping position
      const linkedClipEnd = linkedClip ? linkedClip.startTime + linkedClip.duration : clip.startTime;
      set({
        clips: clips.map(c => {
          if (c.id === clipId) {
            return { ...c, startTime: linkedClipEnd, transitionIn: undefined };
          }
          if (c.id === transition.linkedClipId) {
            return { ...c, transitionOut: undefined };
          }
          return c;
        }),
        clipKeyframes: updatedKeyframes,
      });
    } else {
      // Remove keyframes at the end
      const clipDuration = clip.duration;
      updatedKeyframes.set(clipId, thisClipKeyframes.filter(kf =>
        !(kf.property === 'opacity' && kf.time >= clipDuration - duration)
      ));
      set({
        clips: clips.map(c => {
          if (c.id === clipId) {
            return { ...c, transitionOut: undefined };
          }
          if (c.id === transition.linkedClipId) {
            // Move linked clip back
            const newStart = clip.startTime + clip.duration;
            return { ...c, startTime: newStart, transitionIn: undefined };
          }
          return c;
        }),
        clipKeyframes: updatedKeyframes,
      });
    }

    // Also remove keyframes from linked clip
    if (linkedClip) {
      const linkedKeyframes = updatedKeyframes.get(linkedClip.id) || [];
      if (edge === 'in') {
        // Linked clip had transitionOut
        const linkedDuration = linkedClip.duration;
        updatedKeyframes.set(linkedClip.id, linkedKeyframes.filter(kf =>
          !(kf.property === 'opacity' && kf.time >= linkedDuration - duration)
        ));
      } else {
        // Linked clip had transitionIn
        updatedKeyframes.set(linkedClip.id, linkedKeyframes.filter(kf =>
          !(kf.property === 'opacity' && kf.time <= duration)
        ));
      }
    }

    set({ clipKeyframes: updatedKeyframes });
    invalidateCache();
    log.info('Removed transition', { clipId, edge });
  },

  /**
   * Update the duration of an existing transition
   */
  updateTransitionDuration: (clipId: string, edge: 'in' | 'out', newDuration: number) => {
    const { clips } = get();

    const clip = clips.find(c => c.id === clipId);
    if (!clip) return;

    const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut;
    if (!transition) return;

    // Remove and re-apply with new duration
    const linkedClipId = transition.linkedClipId;
    const type = transition.type as TransitionType;

    // Determine which is clipA and clipB
    const isClipB = edge === 'in';
    const clipAId = isClipB ? linkedClipId : clipId;
    const clipBId = isClipB ? clipId : linkedClipId;

    // First remove the existing transition
    get().removeTransition(clipId, edge);

    // Then apply new transition with updated duration
    get().applyTransition(clipAId, clipBId, type, newDuration);
  },

  /**
   * Find a junction between two clips at a given time
   * Returns the two clips if found, null otherwise
   */
  findClipJunction: (trackId: string, time: number, threshold: number = 0.5) => {
    const { clips } = get();

    // Get clips on this track, sorted by start time
    const trackClips = clips
      .filter(c => c.trackId === trackId)
      .sort((a, b) => a.startTime - b.startTime);

    // Find adjacent clip pairs
    for (let i = 0; i < trackClips.length - 1; i++) {
      const clipA = trackClips[i];
      const clipB = trackClips[i + 1];

      const clipAEnd = clipA.startTime + clipA.duration;
      const gap = clipB.startTime - clipAEnd;

      // Check if clips are touching (small gap)
      if (Math.abs(gap) < 0.1) {
        const junctionTime = clipAEnd;

        // Check if the given time is near this junction
        if (Math.abs(time - junctionTime) < threshold) {
          return { clipA, clipB, junctionTime };
        }
      }
    }

    return null;
  },
});
