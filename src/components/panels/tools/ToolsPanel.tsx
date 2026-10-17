import type { MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { IconLayoutBoardSplit, IconPhoto } from '@tabler/icons-react';
import { startMaskDrawTool, startSegmentTool } from '../../../services/canvasTools';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import { useCanvasToolStore } from '../../../stores/canvasToolStore';
import { useSAM2Store } from '../../../stores/sam2Store';
import { useTimelineStore } from '../../../stores/timeline';
import { useTimelineLayerSyncOwnerMounted } from '../../timeline/hooks/timelineLayerSyncOwners';
import { TIMELINE_TOOL_DEFINITION_BY_ID, TIMELINE_TOOL_GROUPS } from '../../timeline/tools/registry';
import { CANVAS_TOOL_LAYOUT, type CanvasToolDefinition } from './toolsPanelDefinitions';
import { useCanvasToolShortcuts, useToolTargetTracking } from './useToolsPanelBindings';
import './ToolsPanel.css';

function withShortcut(label: string, actionId?: Parameters<ReturnType<typeof getShortcutRegistry>['getLabel']>[0]): string {
  const shortcut = actionId ? getShortcutRegistry().getLabel(actionId) : '';
  return shortcut ? `${label} [${shortcut}]` : label;
}

/** Pointer activation must not leave a focus ring; keyboard focus stays visible. */
function keepPointerFocusOff(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

interface ToolButtonProps {
  active: boolean;
  disabled?: boolean;
  label: string;
  title: string;
  onClick: () => void;
  children: React.ReactNode;
}

function ToolButton({ active, disabled, label, title, onClick, children }: ToolButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      className={`tools-panel-button${active ? ' active' : ''}`}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={keepPointerFocusOff}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}

function CanvasTools() {
  const activeCanvasTool = useCanvasToolStore((state) => state.activeCanvasTool);
  const { maskEditMode, hasSelection } = useTimelineStore(useShallow((state) => ({
    maskEditMode: state.maskEditMode,
    hasSelection: state.selectedClipIds.size > 0,
  })));
  const segmentActive = useSAM2Store((state) => state.isActive);

  const isActive = (tool: CanvasToolDefinition): boolean => {
    if (tool.kind === 'mask') return maskEditMode === tool.id;
    if (tool.kind === 'segment') return segmentActive;
    // Editing an existing mask counts as the Move tool; drawing one does not.
    return activeCanvasTool === tool.id && !maskEditMode.startsWith('drawing') && !segmentActive;
  };
  const activate = (tool: CanvasToolDefinition) => {
    if (tool.kind === 'mask') startMaskDrawTool(tool.id);
    else if (tool.kind === 'segment') startSegmentTool();
    else useCanvasToolStore.getState().setActiveCanvasTool(tool.id);
  };

  return (
    <>
      {CANVAS_TOOL_LAYOUT.map((tool, index) => {
        if (!tool) return <div aria-hidden="true" className="tools-panel-separator" key={`separator-${index}`} />;
        const Icon = tool.icon;
        const disabled = tool.kind === 'mask' && !hasSelection;
        const title = withShortcut(tool.label, tool.shortcutActionId);
        return (
          <ToolButton
            active={isActive(tool)}
            disabled={disabled}
            key={tool.id}
            label={tool.label}
            onClick={() => activate(tool)}
            title={disabled ? `${title} — select a layer first` : `${title}: ${tool.description}`}
          >
            <Icon aria-hidden="true" size={18} stroke={1.6} />
          </ToolButton>
        );
      })}
    </>
  );
}

function TimelineTools() {
  const { activeTimelineToolId, lastTimelineToolByGroup, activateTimelineToolGroup } = useTimelineStore(useShallow((state) => ({
    activeTimelineToolId: state.activeTimelineToolId,
    lastTimelineToolByGroup: state.lastTimelineToolByGroup,
    activateTimelineToolGroup: state.activateTimelineToolGroup,
  })));

  return (
    <>
      {TIMELINE_TOOL_GROUPS.map((group) => {
        const active = group.tools.includes(activeTimelineToolId);
        const shownTool = TIMELINE_TOOL_DEFINITION_BY_ID[active ? activeTimelineToolId : lastTimelineToolByGroup[group.id]];
        const Icon = shownTool?.icon ?? group.icon;
        const label = shownTool ? `${group.label}: ${shownTool.label}` : group.label;
        return (
          <ToolButton
            active={active}
            key={group.id}
            label={label}
            onClick={() => activateTimelineToolGroup(group.id)}
            title={withShortcut(label, group.shortcutActionId)}
          >
            <Icon aria-hidden="true" size={18} stroke={1.6} />
          </ToolButton>
        );
      })}
    </>
  );
}

/**
 * One tool strip for every workspace. It shows the canvas tools of the
 * Preview, or the Timeline's tool groups when the timeline was clicked last;
 * both write the same state as their own toolbars and shortcuts.
 */
export function ToolsPanel() {
  const toolTarget = useCanvasToolStore((state) => state.toolTarget);
  const timelineMounted = useTimelineLayerSyncOwnerMounted();
  const target = timelineMounted ? toolTarget : 'canvas';
  useToolTargetTracking();
  useCanvasToolShortcuts(target === 'canvas');

  return (
    <div aria-label={target === 'canvas' ? 'Canvas tools' : 'Timeline tools'} aria-orientation="vertical" className="tools-panel" role="toolbar">
      {timelineMounted && (
        <div className="tools-panel-targets">
          <ToolButton active={target === 'canvas'} label="Canvas tools" onClick={() => useCanvasToolStore.getState().setToolTarget('canvas')} title="Canvas tools (Preview)">
            <IconPhoto aria-hidden="true" size={15} stroke={1.6} />
          </ToolButton>
          <ToolButton active={target === 'timeline'} label="Timeline tools" onClick={() => useCanvasToolStore.getState().setToolTarget('timeline')} title="Timeline tools">
            <IconLayoutBoardSplit aria-hidden="true" size={15} stroke={1.6} />
          </ToolButton>
        </div>
      )}
      {target === 'canvas' ? <CanvasTools /> : <TimelineTools />}
    </div>
  );
}
