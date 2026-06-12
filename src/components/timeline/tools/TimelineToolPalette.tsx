import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import {
  clearTimelinePlacementCommandPreview,
  hasCurrentTimelinePlacementSource,
  showTimelinePlacementCommandPreview,
} from '../../../services/timelinePlacementCommands';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineToolGroupId, TimelineToolId } from '../../../stores/timeline/types';
import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import { TimelineToolButton } from './TimelineToolButton';
import { TimelineToolFlyout } from './TimelineToolFlyout';
import { runTimelineToolCommand } from './timelineToolCommands';
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

const TOOL_FLYOUT_OWNER_EVENT = 'timelineToolFlyoutOwnerChanged';
const TOOL_FLYOUT_OWNER_KEY = '__masterselectsTimelineToolFlyoutOwner';

declare global {
  interface Window {
    __masterselectsTimelineToolFlyoutOwner?: string | null;
  }
}

function createToolFlyoutOwnerId(): string {
  return `timeline-tool-palette-${Math.random().toString(36).slice(2, 10)}`;
}

function getToolFlyoutOwner(): string | null {
  if (typeof window === 'undefined') return null;
  return window[TOOL_FLYOUT_OWNER_KEY] ?? null;
}

function setToolFlyoutOwner(ownerId: string | null): void {
  if (typeof window === 'undefined') return;
  window[TOOL_FLYOUT_OWNER_KEY] = ownerId;
  window.dispatchEvent(new CustomEvent(TOOL_FLYOUT_OWNER_EVENT, { detail: { ownerId } }));
}

function isPlacementCommandToolId(toolId: TimelineToolId): toolId is TimelinePlacementMode {
  return PLACEMENT_COMMAND_TOOL_IDS.has(toolId);
}

export function TimelineToolPalette() {
  const [ownerId] = useState(createToolFlyoutOwnerId);
  const {
    activeTimelineToolId,
    lastTimelineToolByGroup,
    openTimelineToolGroupId,
    isExporting,
    setActiveTimelineTool,
    activateTimelineToolGroup,
    setOpenTimelineToolGroup,
  } = useTimelineStore(useShallow((state) => ({
    activeTimelineToolId: state.activeTimelineToolId,
    lastTimelineToolByGroup: state.lastTimelineToolByGroup,
    openTimelineToolGroupId: state.openTimelineToolGroupId,
    isExporting: state.isExporting,
    setActiveTimelineTool: state.setActiveTimelineTool,
    activateTimelineToolGroup: state.activateTimelineToolGroup,
    setOpenTimelineToolGroup: state.setOpenTimelineToolGroup,
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
  const [guidedHighlightedToolId, setGuidedHighlightedToolId] = useState<TimelineToolId | null>(null);
  const [armPressDrag, setArmPressDrag] = useState(false);
  const [flyoutOwnerId, setFlyoutOwnerId] = useState<string | null>(() => getToolFlyoutOwner());
  const toolButtonRefs = useRef(new Map<TimelineToolGroupId, HTMLButtonElement>());
  const shortcutRegistry = getShortcutRegistry();
  const hasPlacementSource = hasCurrentTimelinePlacementSource();
  const ownsFlyout = flyoutOwnerId === ownerId;

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
    if (getToolFlyoutOwner() === ownerId) {
      setToolFlyoutOwner(null);
    }
    setOpenTimelineToolGroup(null);
    setFlyoutAnchorRect(null);
    setGuidedHighlightedToolId(null);
    setArmPressDrag(false);
    clearTimelinePlacementCommandPreview();
  }, [ownerId, setOpenTimelineToolGroup]);

  const openFlyout = useCallback((
    groupId: TimelineToolGroupId,
    anchor: HTMLButtonElement,
    options?: { highlightedToolId?: TimelineToolId | null; armPressDrag?: boolean },
  ) => {
    setToolFlyoutOwner(ownerId);
    setFlyoutAnchorRect(anchor.getBoundingClientRect());
    setGuidedHighlightedToolId(options?.highlightedToolId ?? null);
    setArmPressDrag(options?.armPressDrag ?? false);
    setOpenTimelineToolGroup(groupId);
  }, [ownerId, setOpenTimelineToolGroup]);

  const registerToolButton = useCallback((groupId: TimelineToolGroupId, button: HTMLButtonElement | null) => {
    if (button) {
      toolButtonRefs.current.set(groupId, button);
      return;
    }
    toolButtonRefs.current.delete(groupId);
  }, []);

  useEffect(() => {
    const handleFlyoutOwnerChange = (event: Event) => {
      const detail = (event as CustomEvent<{ ownerId?: string | null }>).detail;
      const nextOwnerId = detail?.ownerId ?? null;
      setFlyoutOwnerId(nextOwnerId);
      if (nextOwnerId !== ownerId) {
        setFlyoutAnchorRect(null);
        setGuidedHighlightedToolId(null);
        clearTimelinePlacementCommandPreview();
      }
    };

    window.addEventListener(TOOL_FLYOUT_OWNER_EVENT, handleFlyoutOwnerChange);
    return () => {
      window.removeEventListener(TOOL_FLYOUT_OWNER_EVENT, handleFlyoutOwnerChange);
      if (getToolFlyoutOwner() === ownerId) {
        setToolFlyoutOwner(null);
      }
    };
  }, [ownerId]);

  useEffect(() => {
    const handleGuidedOpenToolGroup = (event: Event) => {
      const detail = (event as CustomEvent<{
        groupId?: TimelineToolGroupId;
        targetToolId?: TimelineToolId;
        anchorElement?: HTMLButtonElement | null;
      }>).detail;
      const groupId = detail?.groupId;
      if (!groupId) return;
      const anchor = toolButtonRefs.current.get(groupId);
      if (!anchor) return;
      if (detail?.anchorElement && detail.anchorElement !== anchor) return;
      openFlyout(groupId, anchor, { highlightedToolId: detail?.targetToolId ?? null });
    };

    window.addEventListener('guidedOpenTimelineToolGroup', handleGuidedOpenToolGroup);
    return () => window.removeEventListener('guidedOpenTimelineToolGroup', handleGuidedOpenToolGroup);
  }, [openFlyout]);

  // While the flyout is held open (press-drag), sliding the pointer onto another
  // category's root button swaps the dropdown to that category — like dragging
  // across a menu bar — so the open menu always tracks the pointer's column.
  useEffect(() => {
    if (!armPressDrag || !ownsFlyout || !openTimelineToolGroupId) return;

    const rootButtonGroupAt = (clientX: number, clientY: number): TimelineToolGroupId | null => {
      const element = document.elementFromPoint(clientX, clientY);
      const rootButton = element?.closest('.timeline-tool-button[data-tool-group]') as HTMLButtonElement | null;
      return (rootButton?.dataset.toolGroup as TimelineToolGroupId | undefined) ?? null;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const groupId = rootButtonGroupAt(event.clientX, event.clientY);
      if (!groupId || groupId === openTimelineToolGroupId) return;
      const rootButton = toolButtonRefs.current.get(groupId);
      if (rootButton) openFlyout(groupId, rootButton, { armPressDrag: true });
    };

    const handlePointerUp = (event: PointerEvent) => {
      // Released over a category root (the original or one dragged onto): activate
      // that group. Releases over a flyout item (select) or empty space (cancel)
      // are resolved by the flyout itself.
      const groupId = rootButtonGroupAt(event.clientX, event.clientY);
      if (groupId) activateTimelineToolGroup(groupId);
    };

    document.addEventListener('pointermove', handlePointerMove, true);
    document.addEventListener('pointerup', handlePointerUp, true);
    return () => {
      document.removeEventListener('pointermove', handlePointerMove, true);
      document.removeEventListener('pointerup', handlePointerUp, true);
    };
  }, [activateTimelineToolGroup, armPressDrag, ownsFlyout, openTimelineToolGroupId, openFlyout]);

  const runCommand = useCallback((tool: TimelineToolDefinition) => {
    if (isExporting && tool.mutatesTimeline) return;
    runTimelineToolCommand(tool.id);
  }, [isExporting]);

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
        const open = ownsFlyout && openTimelineToolGroupId === group.id;
        const title = `${group.tooltipLabel}${groupShortcut ? ` (${groupShortcut})` : ''}\nClick: ${displayTool.label}\nHold: show grouped tools`;

        return (
          <TimelineToolButton
            key={group.id}
            groupId={group.id}
            label={group.label}
            title={title}
            active={active}
            open={open}
            icon={displayTool.icon}
            onActivate={activateTimelineToolGroup}
            onOpen={openFlyout}
          onRegister={registerToolButton}
          />
        );
      })}
      {openGroup && flyoutAnchorRect && ownsFlyout && (
        <TimelineToolFlyout
          anchorRect={flyoutAnchorRect}
          activeToolId={activeTimelineToolId}
          tools={openGroupTools}
          initialHighlightedToolId={guidedHighlightedToolId}
          armPressDrag={armPressDrag}
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
