import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import type { TimelineToolId } from '../../../stores/timeline/types';
import type { TimelineToolDefinition } from './registry';

interface TimelineToolFlyoutProps {
  anchorRect: DOMRect;
  activeToolId: TimelineToolId;
  tools: TimelineToolDefinition[];
  isExporting: boolean;
  onSelect: (tool: TimelineToolDefinition) => void;
  onPreview?: (tool: TimelineToolDefinition | null) => void;
  onClearPreview?: () => void;
  onClose: () => void;
}

const FLYOUT_WIDTH = 246;
const FLYOUT_MARGIN = 8;
const FLYOUT_VERTICAL_GAP = 4;
const FLYOUT_ITEM_HEIGHT = 34;
const FLYOUT_VERTICAL_PADDING = 10;
const FLYOUT_BORDER_HEIGHT = 2;
const FLYOUT_UPWARD_MAX_HEIGHT = 320;

type FlyoutPosition = {
  left: number;
  top?: number;
  bottom?: number;
  maxHeight: number;
};

function getEstimatedFlyoutHeight(toolCount: number, viewportHeight: number): number {
  return Math.min(
    viewportHeight - FLYOUT_MARGIN * 2,
    FLYOUT_VERTICAL_PADDING + FLYOUT_BORDER_HEIGHT + FLYOUT_ITEM_HEIGHT * Math.max(1, toolCount),
  );
}

function getFlyoutPosition(anchorRect: DOMRect, toolCount: number): FlyoutPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const left = Math.min(
    Math.max(FLYOUT_MARGIN, anchorRect.left),
    Math.max(FLYOUT_MARGIN, viewportWidth - FLYOUT_WIDTH - FLYOUT_MARGIN),
  );
  const belowTop = anchorRect.bottom + FLYOUT_VERTICAL_GAP;
  const estimatedHeight = getEstimatedFlyoutHeight(toolCount, viewportHeight);
  const belowMaxHeight = Math.max(FLYOUT_ITEM_HEIGHT, viewportHeight - belowTop - FLYOUT_MARGIN);

  if (belowTop + estimatedHeight <= viewportHeight) {
    return { left, top: belowTop, maxHeight: belowMaxHeight };
  }

  const bottom = viewportHeight - anchorRect.top + FLYOUT_VERTICAL_GAP;
  const aboveMaxHeight = Math.max(
    FLYOUT_ITEM_HEIGHT,
    Math.min(anchorRect.top - FLYOUT_VERTICAL_GAP - FLYOUT_MARGIN, FLYOUT_UPWARD_MAX_HEIGHT),
  );
  return { left, bottom, maxHeight: aboveMaxHeight };
}

export function TimelineToolFlyout({
  anchorRect,
  activeToolId,
  tools,
  isExporting,
  onSelect,
  onPreview,
  onClearPreview,
  onClose,
}: TimelineToolFlyoutProps) {
  const flyoutRef = useRef<HTMLDivElement>(null);
  const shortcutRegistry = getShortcutRegistry();
  const enabledIndexes = useMemo(
    () => tools
      .map((tool, index) => (tool.availability === 'enabled' && !(isExporting && tool.mutatesTimeline) ? index : -1))
      .filter((index) => index >= 0),
    [isExporting, tools],
  );
  const activeIndex = Math.max(0, tools.findIndex((tool) => tool.id === activeToolId));
  const [highlightedIndex, setHighlightedIndex] = useState(activeIndex);
  const position = getFlyoutPosition(anchorRect, tools.length);

  useEffect(() => {
    flyoutRef.current?.focus();
  }, []);

  useEffect(() => {
    const tool = tools[highlightedIndex] ?? null;
    onPreview?.(tool);
  }, [highlightedIndex, onPreview, tools]);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!flyoutRef.current?.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [onClose]);

  const moveHighlight = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const currentEnabledIndex = enabledIndexes.indexOf(highlightedIndex);
    const fallbackIndex = direction > 0 ? -1 : 0;
    const nextEnabledIndex = (currentEnabledIndex >= 0 ? currentEnabledIndex : fallbackIndex) + direction;
    const normalizedIndex = (nextEnabledIndex + enabledIndexes.length) % enabledIndexes.length;
    setHighlightedIndex(enabledIndexes[normalizedIndex]);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveHighlight(1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveHighlight(-1);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const tool = tools[highlightedIndex];
      if (tool?.availability === 'enabled') onSelect(tool);
    }
  };

  return createPortal(
    <div
      ref={flyoutRef}
      className="timeline-tool-flyout"
      role="menu"
      tabIndex={-1}
      style={{ left: position.left, top: position.top, bottom: position.bottom, maxHeight: position.maxHeight }}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onPointerLeave={onClearPreview}
    >
      {tools.map((tool, index) => {
        const Icon = tool.icon;
        const shortcut = tool.shortcutActionId ? shortcutRegistry.getLabel(tool.shortcutActionId) : '';
        const exportBlocked = isExporting && tool.mutatesTimeline;
        const disabled = tool.availability !== 'enabled' || exportBlocked;
        return (
          <button
            key={tool.id}
            type="button"
            role="menuitem"
            className={`timeline-tool-flyout-item ${tool.id === activeToolId ? 'active' : ''} ${index === highlightedIndex ? 'highlighted' : ''}`}
            disabled={disabled}
            title={exportBlocked ? 'Timeline edits are locked during export.' : disabled ? tool.disabledReason : tool.description}
            onMouseEnter={() => setHighlightedIndex(index)}
            onClick={() => {
              if (!disabled) onSelect(tool);
            }}
          >
            <Icon className="timeline-tool-flyout-icon" size={16} stroke={2.1} aria-hidden="true" />
            <span className="timeline-tool-flyout-copy">
              <span className="timeline-tool-flyout-label">{tool.label}</span>
              <span className="timeline-tool-flyout-description">{exportBlocked ? 'Timeline edits are locked during export.' : disabled ? tool.disabledReason : tool.description}</span>
            </span>
            {shortcut && <span className="timeline-tool-flyout-shortcut">{shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}
