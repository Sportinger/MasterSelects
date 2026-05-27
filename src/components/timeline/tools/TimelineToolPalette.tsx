import { useCallback, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  clearTimelinePlacementCommandPreview,
  hasCurrentTimelinePlacementSource,
  runTimelinePlacementCommand,
  showTimelinePlacementCommandPreview,
} from '../../../services/timelinePlacementCommands';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolGroupId } from '../../../stores/timeline/types';
import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import { TimelineToolButton } from './TimelineToolButton';
import { TimelineToolFlyout } from './TimelineToolFlyout';
import {
  TIMELINE_TOOL_DEFINITION_BY_ID,
  TIMELINE_TOOL_GROUPS,
  type TimelineToolDefinition,
} from './registry';

const PLACEMENT_COMMAND_TOOL_IDS = new Set<string>([
  'insert',
  'overwrite',
  'replace',
  'fit-to-fill',
  'append-at-end',
  'place-on-top',
  'ripple-overwrite',
]);

function isPlacementCommandToolId(toolId: string): toolId is TimelinePlacementMode {
  return PLACEMENT_COMMAND_TOOL_IDS.has(toolId);
}

export function TimelineToolPalette() {
  const {
    activeTimelineToolId,
    lastTimelineToolByGroup,
    openTimelineToolGroupId,
    isExporting,
    setActiveTimelineTool,
    activateTimelineToolGroup,
    setOpenTimelineToolGroup,
    splitClipAtPlayhead,
    splitAllClipsAtTime,
    rippleDeleteSelection,
    deleteGapAtTime,
    trimSelectedClipEdgeToPlayhead,
    rippleTrimSelectedClipEdgeToPlayhead,
    liftTimelineRange,
    extractTimelineRange,
    addMarker,
    setInPointAtPlayhead,
    setOutPointAtPlayhead,
  } = useTimelineStore(useShallow((state) => ({
    activeTimelineToolId: state.activeTimelineToolId,
    lastTimelineToolByGroup: state.lastTimelineToolByGroup,
    openTimelineToolGroupId: state.openTimelineToolGroupId,
    isExporting: state.isExporting,
    setActiveTimelineTool: state.setActiveTimelineTool,
    activateTimelineToolGroup: state.activateTimelineToolGroup,
    setOpenTimelineToolGroup: state.setOpenTimelineToolGroup,
    splitClipAtPlayhead: state.splitClipAtPlayhead,
    splitAllClipsAtTime: state.splitAllClipsAtTime,
    rippleDeleteSelection: state.rippleDeleteSelection,
    deleteGapAtTime: state.deleteGapAtTime,
    trimSelectedClipEdgeToPlayhead: state.trimSelectedClipEdgeToPlayhead,
    rippleTrimSelectedClipEdgeToPlayhead: state.rippleTrimSelectedClipEdgeToPlayhead,
    liftTimelineRange: state.liftTimelineRange,
    extractTimelineRange: state.extractTimelineRange,
    addMarker: state.addMarker,
    setInPointAtPlayhead: state.setInPointAtPlayhead,
    setOutPointAtPlayhead: state.setOutPointAtPlayhead,
  })));
  useMediaStore(useShallow((state) => ({
    sourceMonitorFileId: state.sourceMonitorFileId,
    sourceMonitorInPoint: state.sourceMonitorInPoint,
    sourceMonitorOutPoint: state.sourceMonitorOutPoint,
    selectedIds: state.selectedIds,
    files: state.files,
    compositions: state.compositions,
    textItems: state.textItems,
    solidItems: state.solidItems,
    meshItems: state.meshItems,
    cameraItems: state.cameraItems,
    splatEffectorItems: state.splatEffectorItems,
    mathSceneItems: state.mathSceneItems,
    motionShapeItems: state.motionShapeItems,
    signalAssets: state.signalAssets,
  })));
  const [flyoutAnchorRect, setFlyoutAnchorRect] = useState<DOMRect | null>(null);
  const shortcutRegistry = getShortcutRegistry();
  const hasPlacementSource = hasCurrentTimelinePlacementSource();

  const openGroup = openTimelineToolGroupId
    ? TIMELINE_TOOL_GROUPS.find((group) => group.id === openTimelineToolGroupId) ?? null
    : null;
  const openGroupTools = useMemo(
    () => openGroup?.tools.map((toolId) => {
      const definition = TIMELINE_TOOL_DEFINITION_BY_ID[toolId];
      if (definition.availability !== 'requires-source') return definition;
      if (!hasPlacementSource) return definition;
      return {
        ...definition,
        availability: 'enabled' as const,
      };
    }) ?? [],
    [hasPlacementSource, openGroup],
  );

  const closeFlyout = useCallback(() => {
    setOpenTimelineToolGroup(null);
    setFlyoutAnchorRect(null);
    clearTimelinePlacementCommandPreview();
  }, [setOpenTimelineToolGroup]);

  const openFlyout = useCallback((groupId: TimelineToolGroupId, anchor: HTMLButtonElement) => {
    setFlyoutAnchorRect(anchor.getBoundingClientRect());
    setOpenTimelineToolGroup(groupId);
  }, [setOpenTimelineToolGroup]);

  const runCommand = useCallback((tool: TimelineToolDefinition) => {
    if (isExporting && tool.mutatesTimeline) return;
    if (tool.id === 'split-at-playhead') {
      splitClipAtPlayhead();
    } else if (tool.id === 'split-all-at-playhead') {
      splitAllClipsAtTime(useTimelineStore.getState().playheadPosition);
    } else if (tool.id === 'ripple-delete') {
      rippleDeleteSelection();
    } else if (tool.id === 'delete-gap') {
      deleteGapAtTime(useTimelineStore.getState().playheadPosition);
    } else if (tool.id === 'trim-start-to-playhead') {
      trimSelectedClipEdgeToPlayhead('start');
    } else if (tool.id === 'trim-end-to-playhead') {
      trimSelectedClipEdgeToPlayhead('end');
    } else if (tool.id === 'ripple-trim-start-to-playhead') {
      rippleTrimSelectedClipEdgeToPlayhead('start');
    } else if (tool.id === 'ripple-trim-end-to-playhead') {
      rippleTrimSelectedClipEdgeToPlayhead('end');
    } else if (tool.id === 'lift-range') {
      liftTimelineRange();
    } else if (tool.id === 'extract-range') {
      extractTimelineRange();
    } else if (tool.id === 'marker') {
      addMarker(useTimelineStore.getState().playheadPosition);
    } else if (tool.id === 'in-point') {
      setInPointAtPlayhead();
    } else if (tool.id === 'out-point') {
      setOutPointAtPlayhead();
    } else if (isPlacementCommandToolId(tool.id)) {
      void runTimelinePlacementCommand(tool.id);
    }
  }, [
    addMarker,
    deleteGapAtTime,
    extractTimelineRange,
    isExporting,
    liftTimelineRange,
    rippleDeleteSelection,
    rippleTrimSelectedClipEdgeToPlayhead,
    setInPointAtPlayhead,
    setOutPointAtPlayhead,
    splitAllClipsAtTime,
    splitClipAtPlayhead,
    trimSelectedClipEdgeToPlayhead,
  ]);

  const selectTool = useCallback((tool: TimelineToolDefinition) => {
    if (tool.availability !== 'enabled') return;
    clearTimelinePlacementCommandPreview();
    if (tool.kind === 'command') {
      runCommand(tool);
      closeFlyout();
      return;
    }
    setActiveTimelineTool(tool.id);
    closeFlyout();
  }, [closeFlyout, runCommand, setActiveTimelineTool]);

  const previewTool = useCallback((tool: TimelineToolDefinition | null) => {
    if (!tool || tool.availability !== 'enabled' || !isPlacementCommandToolId(tool.id)) {
      clearTimelinePlacementCommandPreview();
      return;
    }
    showTimelinePlacementCommandPreview(tool.id);
  }, []);

  return (
    <div className="timeline-tool-palette" role="toolbar" aria-label="Timeline tools">
      {TIMELINE_TOOL_GROUPS.map((group) => {
        const lastToolId = lastTimelineToolByGroup[group.id] ?? group.defaultToolId;
        const displayTool = TIMELINE_TOOL_DEFINITION_BY_ID[lastToolId] ?? TIMELINE_TOOL_DEFINITION_BY_ID[group.defaultToolId];
        const groupShortcut = group.shortcutActionId ? shortcutRegistry.getLabel(group.shortcutActionId) : '';
        const active = group.tools.includes(activeTimelineToolId);
        const title = `${group.tooltipLabel}${groupShortcut ? ` (${groupShortcut})` : ''}\nClick: ${displayTool.label}\nHold: show grouped tools`;

        return (
          <TimelineToolButton
            key={group.id}
            groupId={group.id}
            label={group.label}
            title={title}
            active={active}
            icon={displayTool.icon}
            onActivate={activateTimelineToolGroup}
            onOpen={openFlyout}
          />
        );
      })}
      {openGroup && flyoutAnchorRect && (
        <TimelineToolFlyout
          anchorRect={flyoutAnchorRect}
          activeToolId={activeTimelineToolId}
          tools={openGroupTools}
          isExporting={isExporting}
          onSelect={selectTool}
          onPreview={previewTool}
          onClearPreview={clearTimelinePlacementCommandPreview}
          onClose={closeFlyout}
        />
      )}
    </div>
  );
}
