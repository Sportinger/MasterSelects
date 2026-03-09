// AI Visual Feedback Helpers
// Centralized functions for triggering visual feedback during AI tool execution:
// - Panel/tab switching (dock activation + properties tab)
// - Preview canvas flash (capture shutter, undo/redo flash)
// - Timeline marker animations (via CSS class toggling)

import { isAIExecutionActive } from './executionState';

/** Activate a dock panel tab (makes it visible + focused) */
export function activateDockPanel(panelType: string): void {
  if (!isAIExecutionActive()) return;
  // Lazy import to avoid circular deps — no guard inside .then() since we checked above
  import('../../stores/dockStore').then(({ useDockStore }) => {
    useDockStore.getState().activatePanelType(panelType as any);
  });
}

/** Request a specific tab in the Properties panel (transform, effects, masks, transcript, analysis, volume, text) */
export function openPropertiesTab(tab: string): void {
  window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
}

/** Select a clip and open a specific properties tab */
export function selectClipAndOpenTab(clipId: string, tab: string): void {
  if (!isAIExecutionActive()) return;
  import('../../stores/timeline').then(({ useTimelineStore }) => {
    useTimelineStore.getState().selectClips([clipId]);
  });
  // Activate the properties panel in dock
  activateDockPanel('clip-properties');
  // Small delay so selection propagates before tab switch
  // No guard needed — we already checked isAIExecutionActive above
  setTimeout(() => openPropertiesTab(tab), 50);
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
