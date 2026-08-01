// useTimelineKeyboard - Global keyboard shortcuts for timeline
// Uses central ShortcutRegistry for configurable key bindings

import { useEffect } from 'react';
import type { TimelineClip } from '../../../types';
import type { Composition } from '../../../stores/mediaStore';
import { ALL_BLEND_MODES } from '../constants';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  claimShortcut,
  isTextEntryTarget,
} from '../../../services/shortcutFocusPolicy';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../stores/mediaStore/compositionVisibility';
import type { TimelineEditOperationActions } from '../../../stores/timeline/types';
import { TIMELINE_TOOL_DEFINITIONS } from '../tools/registry';
import { runTimelineToolCommand } from '../tools/timelineToolCommands';

const GROUP_SHORTCUT_ACTIONS = new Set([
  'tool.selectionGroup',
  'tool.cutToggle',
  'tool.trimGroup',
  'tool.placementGroup',
  'tool.navigationGroup',
]);

const MASK_CONTEXT_SHORTCUT_ACTIONS = [
  'mask.pen',
  'mask.edit',
  'mask.rectangle',
  'mask.ellipse',
  'mask.closePath',
  'mask.invert',
  'mask.toggleOutline',
  'mask.selectAllVertices',
  'mask.toggleVertexHandles',
] as const;

function getFreshPlayheadPosition(fallbackPosition: number): number {
  const storePosition = useTimelineStore.getState().playheadPosition;
  return Number.isFinite(storePosition) ? storePosition : fallbackPosition;
}

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
  toggleTimelineCurveMode: () => void;

  // Selection
  selectedClipIds: Set<string>;
  selectedKeyframeIds: Set<string>;

  // Clip operations
  applyTimelineEditOperation: TimelineEditOperationActions['applyTimelineEditOperation'];
  splitClipAtPlayhead: () => void;

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
  toggleTimelineCurveMode,
  selectedClipIds,
  selectedKeyframeIds,
  applyTimelineEditOperation,
  splitClipAtPlayhead,
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
      if (isTextEntryTarget(e.target)) {
        return;
      }

      // Select all — scoped to whichever panel the mouse is over. Over the media
      // panel it selects all media items; over the timeline it selects all clips.
      // Over neither (e.g. mask editing in the preview) it falls through so other
      // select-all handlers still run.
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === 'a' || e.key === 'A')) {
        if (typeof document !== 'undefined') {
          if (document.querySelector('.media-panel:hover')) {
            e.preventDefault();
            const mediaState = useMediaStore.getState();
            const ids = [
              ...mediaState.files.map((file) => file.id),
              ...mediaState.compositions.filter(isUserVisibleComposition).map((composition) => composition.id),
            ];
            mediaState.setSelection(ids);
            return;
          }
          if (document.querySelector('.timeline-container:hover')) {
            e.preventDefault();
            const timelineState = useTimelineStore.getState();
            timelineState.selectClips(timelineState.clips.map((clip) => clip.id));
            return;
          }
        }
      }

      if (registry.matches('view.toggleCurveMode', e)) {
        if (!claimShortcut(e, 'view.toggleCurveMode')) return;
        toggleTimelineCurveMode();
        return;
      }

      // Play/Pause claims global ownership and releases stale control focus.
      if (registry.matches('playback.playPause', e)) {
        if (!claimShortcut(e, 'playback.playPause', {
          blurFocusedControl: true,
          deferToFocusedControl: false,
        })) return;
        if (isPlaying) {
          pause();
        } else {
          play();
        }
        return;
      }

      // Set In point
      if (registry.matches('edit.setIn', e)) {
        if (!claimShortcut(e, 'edit.setIn')) return;
        setInPointAtPlayhead();
        return;
      }

      // Set Out point
      if (registry.matches('edit.setOut', e)) {
        if (!claimShortcut(e, 'edit.setOut')) return;
        setOutPointAtPlayhead();
        return;
      }

      // Clear In/Out
      if (registry.matches('edit.clearInOut', e)) {
        if (!claimShortcut(e, 'edit.clearInOut')) return;
        clearInOut();
        return;
      }

      // Play reverse
      if (registry.matches('playback.playReverse', e)) {
        if (!claimShortcut(e, 'playback.playReverse')) return;
        playReverse();
        return;
      }

      // Pause
      if (registry.matches('playback.pause', e)) {
        if (!claimShortcut(e, 'playback.pause')) return;
        pause();
        return;
      }

      // Toggle loop / Play forward
      if (registry.matches('playback.toggleLoop', e)) {
        if (!claimShortcut(e, 'playback.toggleLoop')) return;
        toggleLoopPlayback();
        return;
      }
      if (registry.matches('playback.playForward', e)) {
        if (!claimShortcut(e, 'playback.playForward')) return;
        playForward();
        return;
      }

      // Add marker
      if (registry.matches('edit.addMarker', e)) {
        if (!claimShortcut(e, 'edit.addMarker')) return;
        if (addMarker) {
          addMarker(playheadPosition);
        }
        return;
      }

      // Delete: remove selected keyframes first, then clips
      if (registry.matches('edit.delete', e)) {
        const timelineState = useTimelineStore.getState();
        // A selected Timeline keyframe is an explicit delete target even while
        // the mask editor is open. Yield to MaskOverlay only when no keyframe
        // selection exists (for example, while deleting selected vertices).
        if (timelineState.maskEditMode !== 'none' && selectedKeyframeIds.size === 0) return;
        if (!claimShortcut(e, 'edit.delete')) return;
        const propertiesSelection = timelineState.propertiesSelection;
        if (propertiesSelection?.kind === 'transition') {
          const transactionId = `keyboard-delete-transition:${propertiesSelection.transitionId}:${Date.now()}`;
          applyTimelineEditOperation({
            id: transactionId,
            type: 'transition-remove',
            transactionId,
            historyBatchId: transactionId,
            source: 'shortcut',
            clipId: propertiesSelection.clipId,
            edge: propertiesSelection.edge,
            transitionId: propertiesSelection.transitionId,
          }, {
            source: 'shortcut',
            historyLabel: 'Remove transition',
          });
          return;
        }

        if (selectedKeyframeIds.size > 0 || selectedClipIds.size > 0) {
          const transactionId = `keyboard-delete:${Date.now()}`;
          applyTimelineEditOperation({
            id: transactionId,
            type: 'keyboard-delete-command',
            transactionId,
            historyBatchId: transactionId,
            source: 'shortcut',
            command: 'delete',
            priority: selectedKeyframeIds.size > 0 ? 'keyframes-first' : 'clips-only',
            keyframeIds: [...selectedKeyframeIds],
            clipIds: [...selectedClipIds],
            includeLinked: false,
          }, {
            source: 'shortcut',
            historyLabel: selectedKeyframeIds.size > 0 ? 'Delete keyframes' : 'Delete clips',
          });
        }
        return;
      }

      // Copy
      if (registry.matches('edit.copy', e)) {
        const timelineState = useTimelineStore.getState();
        if (timelineState.maskPanelActive && timelineState.activeMaskId) return;
        if (!claimShortcut(e, 'edit.copy')) return;
        if (selectedKeyframeIds.size > 0) {
          copyKeyframes();
        } else {
          copyClips();
        }
        return;
      }

      // Paste
      if (registry.matches('edit.paste', e)) {
        const timelineState = useTimelineStore.getState();
        if (timelineState.maskPanelActive && timelineState.hasClipboardMask()) return;
        if (!claimShortcut(e, 'edit.paste')) return;
        pasteKeyframes();
        return;
      }

      // Split at playhead
      if (registry.matches('edit.splitAtPlayhead', e)) {
        if (!claimShortcut(e, 'edit.splitAtPlayhead')) return;
        splitClipAtPlayhead();
        return;
      }

      const timelineToolState = useTimelineStore.getState();
      if (
        timelineToolState.maskPanelActive &&
        MASK_CONTEXT_SHORTCUT_ACTIONS.some((action) => registry.matches(action, e))
      ) {
        return;
      }

      // Timeline tool selection
      if (registry.matches('tool.select', e)) {
        if (!claimShortcut(e, 'tool.select')) return;
        timelineToolState.setActiveTimelineTool('select');
        return;
      }

      if (registry.matches('tool.selectionGroup', e)) {
        if (!claimShortcut(e, 'tool.selectionGroup')) return;
        timelineToolState.cycleTimelineToolGroup('selection', e.shiftKey ? -1 : 1);
        return;
      }

      // Legacy cut/razor shortcut. Keep old custom bindings working, but make
      // the shortcut land on the single Blade/Razor tool instead of cycling to
      // Blade All Tracks.
      if (registry.matches('tool.cutToggle', e)) {
        if (!claimShortcut(e, 'tool.cutToggle')) return;
        timelineToolState.setActiveTimelineTool('blade');
        return;
      }

      if (registry.matches('tool.trimGroup', e)) {
        if (!claimShortcut(e, 'tool.trimGroup')) return;
        timelineToolState.cycleTimelineToolGroup('trim', e.shiftKey ? -1 : 1);
        return;
      }

      if (registry.matches('tool.placementGroup', e)) {
        if (!claimShortcut(e, 'tool.placementGroup')) return;
        timelineToolState.cycleTimelineToolGroup('placement', e.shiftKey ? -1 : 1);
        return;
      }

      if (registry.matches('tool.navigationGroup', e)) {
        if (!claimShortcut(e, 'tool.navigationGroup')) return;
        timelineToolState.cycleTimelineToolGroup('navigation', e.shiftKey ? -1 : 1);
        return;
      }

      for (const tool of TIMELINE_TOOL_DEFINITIONS) {
        if (!tool.shortcutActionId || GROUP_SHORTCUT_ACTIONS.has(tool.shortcutActionId)) continue;
        if (!registry.matches(tool.shortcutActionId, e)) continue;

        if (!claimShortcut(e, tool.shortcutActionId)) return;
        if (tool.kind === 'command') {
          runTimelineToolCommand(tool.id);
        } else {
          timelineToolState.setActiveTimelineTool(tool.id);
        }
        return;
      }

      // Escape: Exit cut tool mode (not configurable, always Escape)
      if (e.key === 'Escape' && toolMode === 'cut') {
        e.preventDefault();
        toggleCutTool();
        return;
      }

      // Blend mode cycling
      const blendModeAction = registry.matches('edit.blendModeNext', e)
        ? 'edit.blendModeNext'
        : registry.matches('edit.blendModePrev', e)
          ? 'edit.blendModePrev'
          : null;
      if (blendModeAction) {
        if (!claimShortcut(e, blendModeAction)) return;
        const firstSelectedId = selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
        if (!firstSelectedId) return;

        const clip = clipMap.get(firstSelectedId);
        if (!clip) return;

        const currentMode = clip.transform?.blendMode || 'normal';
        const currentIndex = ALL_BLEND_MODES.indexOf(currentMode);
        const direction = blendModeAction === 'edit.blendModeNext' ? 1 : -1;
        const nextIndex =
          (currentIndex + direction + ALL_BLEND_MODES.length) %
          ALL_BLEND_MODES.length;
        const nextMode = ALL_BLEND_MODES[nextIndex];
        const transactionId = `keyboard-cycle-blend-mode:${nextMode}:${Date.now()}`;

        applyTimelineEditOperation({
          id: transactionId,
          type: 'keyboard-cycle-blend-mode-command',
          transactionId,
          historyBatchId: transactionId,
          source: 'shortcut',
          command: 'cycle-blend-mode',
          clipIds: [...selectedClipIds],
          direction: direction === 1 ? 'next' : 'previous',
          anchorClipId: firstSelectedId,
          currentBlendMode: currentMode,
          nextBlendMode: nextMode,
          blendModeSequence: ALL_BLEND_MODES,
        }, { source: 'shortcut', historyLabel: 'Cycle blend mode' });
        return;
      }

      // Frame backward
      if (registry.matches('nav.frameBackward', e)) {
        const timelineState = useTimelineStore.getState();
        if (timelineState.maskEditMode === 'editing' && timelineState.selectedVertexIds.size > 0) return;
        if (!claimShortcut(e, 'nav.frameBackward')) return;
        if (activeComposition) {
          const frameRate = Math.max(1, activeComposition.frameRate || 30);
          const currentPosition = getFreshPlayheadPosition(playheadPosition);
          const currentFrame = Math.round(currentPosition * frameRate);
          const newPosition = Math.max(0, (currentFrame - 1) / frameRate);
          setPlayheadPosition(newPosition);
        }
        return;
      }

      // Frame forward
      if (registry.matches('nav.frameForward', e)) {
        const timelineState = useTimelineStore.getState();
        if (timelineState.maskEditMode === 'editing' && timelineState.selectedVertexIds.size > 0) return;
        if (!claimShortcut(e, 'nav.frameForward')) return;
        if (activeComposition) {
          const frameRate = Math.max(1, activeComposition.frameRate || 30);
          const currentPosition = getFreshPlayheadPosition(playheadPosition);
          const currentFrame = Math.round(currentPosition * frameRate);
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
    toggleTimelineCurveMode,
    selectedClipIds,
    selectedKeyframeIds,
    applyTimelineEditOperation,
    splitClipAtPlayhead,
    clipMap,
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
