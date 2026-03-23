// useTimelineKeyboard - Global keyboard shortcuts for timeline
// Uses central ShortcutRegistry for configurable key bindings

import { useEffect } from 'react';
import type { TimelineClip, ClipTransform } from '../../../types';
import type { Composition } from '../../../stores/mediaStore';
import { ALL_BLEND_MODES } from '../constants';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';

interface UseTimelineKeyboardProps {
  // Playback
  isPlaying: boolean;
  play: () => void;
  pause: () => void;
  playForward: () => void;
  playReverse: () => void;

  // In/Out points
  setInPointAtPlayhead: () => void;
  setOutPointAtPlayhead: () => void;
  clearInOut: () => void;
  toggleLoopPlayback: () => void;

  // Selection
  selectedClipIds: Set<string>;
  selectedKeyframeIds: Set<string>;

  // Clip operations
  removeClip: (id: string) => void;
  removeKeyframe: (id: string) => void;
  splitClipAtPlayhead: () => void;
  updateClipTransform: (id: string, transform: Partial<ClipTransform>) => void;

  // Copy/Paste
  copyClips: () => void;
  pasteClips: () => void;
  copyKeyframes: () => void;
  pasteKeyframes: () => void;

  // Tool mode
  toolMode: 'select' | 'cut';
  toggleCutTool: () => void;

  // Clip lookup
  clipMap: Map<string, TimelineClip>;

  // Playhead navigation
  activeComposition: Composition | null;
  playheadPosition: number;
  duration: number;
  setPlayheadPosition: (time: number) => void;

  // Markers
  addMarker?: (time: number) => string;
}

export function useTimelineKeyboard({
  isPlaying,
  play,
  pause,
  playForward,
  playReverse,
  setInPointAtPlayhead,
  setOutPointAtPlayhead,
  clearInOut,
  toggleLoopPlayback,
  selectedClipIds,
  selectedKeyframeIds,
  removeClip,
  removeKeyframe,
  splitClipAtPlayhead,
  updateClipTransform,
  copyClips,
  pasteClips,
  copyKeyframes,
  pasteKeyframes,
  toolMode,
  toggleCutTool,
  clipMap,
  activeComposition,
  playheadPosition,
  duration,
  setPlayheadPosition,
  addMarker,
}: UseTimelineKeyboardProps): void {
  useEffect(() => {
    const registry = getShortcutRegistry();

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if not typing in a text input
      const isTextInput =
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLInputElement &&
          e.target.type !== 'range' &&
          e.target.type !== 'checkbox' &&
          e.target.type !== 'radio');

      if (isTextInput) {
        return;
      }

      // Play/Pause (also blur any focused slider/checkbox)
      if (registry.matches('playback.playPause', e)) {
        if (e.target instanceof HTMLInputElement) {
          e.target.blur();
        }
        e.preventDefault();
        if (isPlaying) {
          pause();
        } else {
          play();
        }
        return;
      }

      // Set In point
      if (registry.matches('edit.setIn', e)) {
        e.preventDefault();
        setInPointAtPlayhead();
        return;
      }

      // Set Out point
      if (registry.matches('edit.setOut', e)) {
        e.preventDefault();
        setOutPointAtPlayhead();
        return;
      }

      // Clear In/Out
      if (registry.matches('edit.clearInOut', e)) {
        e.preventDefault();
        clearInOut();
        return;
      }

      // Play reverse
      if (registry.matches('playback.playReverse', e)) {
        e.preventDefault();
        playReverse();
        return;
      }

      // Pause
      if (registry.matches('playback.pause', e)) {
        e.preventDefault();
        pause();
        return;
      }

      // Toggle loop / Play forward
      if (registry.matches('playback.toggleLoop', e)) {
        e.preventDefault();
        toggleLoopPlayback();
        return;
      }
      if (registry.matches('playback.playForward', e)) {
        e.preventDefault();
        playForward();
        return;
      }

      // Add marker
      if (registry.matches('edit.addMarker', e)) {
        e.preventDefault();
        if (addMarker) {
          addMarker(playheadPosition);
        }
        return;
      }

      // Delete: remove selected keyframes first, then clips
      if (registry.matches('edit.delete', e)) {
        e.preventDefault();
        if (selectedKeyframeIds.size > 0) {
          [...selectedKeyframeIds].forEach(keyframeId => removeKeyframe(keyframeId));
          return;
        }
        if (selectedClipIds.size > 0) {
          [...selectedClipIds].forEach(clipId => removeClip(clipId));
        }
        return;
      }

      // Copy
      if (registry.matches('edit.copy', e)) {
        e.preventDefault();
        if (selectedKeyframeIds.size > 0) {
          copyKeyframes();
        } else {
          copyClips();
        }
        return;
      }

      // Paste
      if (registry.matches('edit.paste', e)) {
        e.preventDefault();
        pasteKeyframes();
        return;
      }

      // Split at playhead
      if (registry.matches('edit.splitAtPlayhead', e)) {
        e.preventDefault();
        splitClipAtPlayhead();
        return;
      }

      // Cut/Razor tool toggle
      if (registry.matches('tool.cutToggle', e)) {
        e.preventDefault();
        toggleCutTool();
        return;
      }

      // Escape: Exit cut tool mode (not configurable, always Escape)
      if (e.key === 'Escape' && toolMode === 'cut') {
        e.preventDefault();
        toggleCutTool();
        return;
      }

      // Blend mode cycling
      if (registry.matches('edit.blendModeNext', e) || registry.matches('edit.blendModePrev', e)) {
        e.preventDefault();
        const firstSelectedId = selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
        if (!firstSelectedId) return;

        const clip = clipMap.get(firstSelectedId);
        if (!clip) return;

        const currentMode = clip.transform?.blendMode || 'normal';
        const currentIndex = ALL_BLEND_MODES.indexOf(currentMode);
        const direction = registry.matches('edit.blendModeNext', e) ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + ALL_BLEND_MODES.length) %
          ALL_BLEND_MODES.length;
        const nextMode = ALL_BLEND_MODES[nextIndex];

        [...selectedClipIds].forEach(clipId => {
          updateClipTransform(clipId, { blendMode: nextMode });
        });
        return;
      }

      // Frame backward
      if (registry.matches('nav.frameBackward', e)) {
        e.preventDefault();
        if (activeComposition) {
          const frameRate = Math.max(1, activeComposition.frameRate || 30);
          const currentFrame = Math.round(playheadPosition * frameRate);
          const newPosition = Math.max(0, (currentFrame - 1) / frameRate);
          setPlayheadPosition(newPosition);
        }
        return;
      }

      // Frame forward
      if (registry.matches('nav.frameForward', e)) {
        e.preventDefault();
        if (activeComposition) {
          const frameRate = Math.max(1, activeComposition.frameRate || 30);
          const currentFrame = Math.round(playheadPosition * frameRate);
          const maxFrame = Math.round(duration * frameRate);
          const newPosition = Math.min(duration, (Math.min(maxFrame, currentFrame + 1)) / frameRate);
          setPlayheadPosition(newPosition);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isPlaying,
    play,
    pause,
    playForward,
    playReverse,
    setInPointAtPlayhead,
    setOutPointAtPlayhead,
    clearInOut,
    toggleLoopPlayback,
    selectedClipIds,
    selectedKeyframeIds,
    removeClip,
    removeKeyframe,
    splitClipAtPlayhead,
    clipMap,
    updateClipTransform,
    copyClips,
    pasteClips,
    copyKeyframes,
    pasteKeyframes,
    toolMode,
    toggleCutTool,
    activeComposition,
    playheadPosition,
    duration,
    setPlayheadPosition,
    addMarker,
  ]);
}
