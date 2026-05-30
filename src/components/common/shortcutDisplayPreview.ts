export const SHORTCUT_DISPLAY_PREVIEW_EVENT = 'masterselects:shortcut-display-preview';

export interface ShortcutDisplayPreviewDetail {
  durationMs?: number;
}

export function requestShortcutDisplayPreview(durationMs?: number): void {
  window.dispatchEvent(new CustomEvent<ShortcutDisplayPreviewDetail>(
    SHORTCUT_DISPLAY_PREVIEW_EVENT,
    { detail: { durationMs } },
  ));
}
