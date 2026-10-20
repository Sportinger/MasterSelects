import { useEffect } from 'react';
import { startMaskDrawTool } from '../../../services/canvasTools';
import { claimShortcut } from '../../../services/shortcutFocusPolicy';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';
import type { ShortcutActionId } from '../../../services/shortcutTypes';
import { useCanvasToolStore } from '../../../stores/canvasToolStore';
import { useTimelineStore } from '../../../stores/timeline';

const CANVAS_PANEL_TYPES = new Set(['preview', 'multi-preview']);

/** The Tools panel follows the surface the user last clicked: a preview or the timeline. */
export function useToolTargetTracking(): void {
  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const pane = (event.target as Element | null)?.closest?.('[data-active-panel-type]');
      const panelType = pane?.getAttribute('data-active-panel-type');
      const store = useCanvasToolStore.getState();
      if (panelType && CANVAS_PANEL_TYPES.has(panelType)) {
        store.setToolTarget('canvas');
      } else if (panelType === 'timeline') {
        store.setToolTarget('timeline');
      }
    };
    window.addEventListener('pointerdown', handlePointerDown, true);
    return () => window.removeEventListener('pointerdown', handlePointerDown, true);
  }, []);
}

const CANVAS_TOOL_SHORTCUTS: readonly [ShortcutActionId, () => void][] = [
  ['tool.select', () => useCanvasToolStore.getState().setActiveCanvasTool('move')],
  ['tool.hand', () => useCanvasToolStore.getState().setActiveCanvasTool('hand')],
  ['tool.zoom', () => useCanvasToolStore.getState().setActiveCanvasTool('zoom')],
  ['tool.text', () => useCanvasToolStore.getState().setActiveCanvasTool('text')],
  ['mask.rectangle', () => { startMaskDrawTool('drawingRect'); }],
  ['mask.ellipse', () => { startMaskDrawTool('drawingEllipse'); }],
  ['mask.pen', () => { startMaskDrawTool('drawingPen'); }],
];

/**
 * Tool shortcuts for the canvas. They run in the capture phase so they win
 * over the Timeline's handling of the same keys while the canvas is the
 * target, and step aside while the Masks tab owns the mask shortcuts.
 */
export function useCanvasToolShortcuts(canvasIsTarget: boolean): void {
  useEffect(() => {
    if (!canvasIsTarget) return undefined;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (useTimelineStore.getState().maskPanelActive) return;
      const registry = getShortcutRegistry();
      const match = CANVAS_TOOL_SHORTCUTS.find(([action]) => registry.matches(action, event));
      if (!match || !claimShortcut(event, match[0])) return;
      match[1]();
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [canvasIsTarget]);
}
