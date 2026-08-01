// AI Visual Feedback Helpers
// Centralized functions for triggering visual feedback during AI tool execution:
// - Panel/tab switching (dock activation + properties tab)
// - Preview canvas flash (capture shutter, undo/redo flash)
// - Timeline marker animations (via CSS class toggling)

import { PANEL_CONFIGS, type PanelType } from '../../types/dock';
import { useTimelineStore } from '../../stores/timeline';
import { isAIExecutionActive } from './executionState';

function isPanelType(value: string): value is PanelType {
  return value in PANEL_CONFIGS;
}

/** Activate a dock panel tab (makes it visible + focused) */
export function activateDockPanel(panelType: string): void {
  if (!isAIExecutionActive()) return;
  if (!isPanelType(panelType)) return;
  // Lazy import avoids a cycle with the dock store.
  void import('../../stores/dockStore').then(({ FACTORY_START_LAYOUT_ID, useDockStore }) => {
    if (useDockStore.getState().activeSavedLayoutId === FACTORY_START_LAYOUT_ID) return;
    useDockStore.getState().activatePanelType(panelType);
  });
}

/** Request a specific tab in the Properties panel (transform, effects, masks, transcript, analysis, volume, text) */
export function openPropertiesTab(tab: string): void {
  void import('../../stores/dockStore').then(({ FACTORY_START_LAYOUT_ID, useDockStore }) => {
    if (useDockStore.getState().activeSavedLayoutId === FACTORY_START_LAYOUT_ID) return;
    window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
  });
}

/** Select a clip and open a specific properties tab */
export function selectClipAndOpenTab(clipId: string, tab: string): void {
  if (!isAIExecutionActive()) return;
  // Selection is part of the editing result and must land before the owning AI
  // history batch closes. Dock activation can remain lazy, but deferring the
  // timeline import made redo restore the clips without their final selection.
  useTimelineStore.getState().selectClips([clipId]);
  void import('../../stores/dockStore').then(({ FACTORY_START_LAYOUT_ID, useDockStore }) => {
    if (useDockStore.getState().activeSavedLayoutId === FACTORY_START_LAYOUT_ID) return;
    useDockStore.getState().activatePanelType('clip-properties');
    // Small delay so selection propagates before the tab switch.
    setTimeout(() => openPropertiesTab(tab), 50);
  });
}

/** Flash the preview canvas with a brief overlay effect */
export function flashPreviewCanvas(type: 'shutter' | 'undo' | 'redo' | 'import'): void {
  if (!isAIExecutionActive()) return;
  const preview = document.querySelector('.preview-canvas-wrapper') || document.querySelector('.preview-container');
  if (!preview) return;

  const flash = document.createElement('div');
  flash.className = `ai-preview-flash ai-preview-flash-${type}`;
  preview.appendChild(flash);
  // Remove after animation
  setTimeout(() => flash.remove(), type === 'shutter' ? 400 : 600);
}

/** Dispatch a custom event to the timeline for marker animation */
export function animateMarker(markerId: string, action: 'add' | 'remove'): void {
  if (!isAIExecutionActive()) return;
  window.dispatchEvent(new CustomEvent('ai-marker-feedback', { detail: { markerId, action } }));
}

/** Dispatch a custom event for keyframe animation */
export function animateKeyframe(clipId: string, action: 'add' | 'remove'): void {
  if (!isAIExecutionActive()) return;
  window.dispatchEvent(new CustomEvent('ai-keyframe-feedback', { detail: { clipId, action } }));
}
