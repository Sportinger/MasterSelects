const PREVIEW_CONTAINER_SELECTOR = '.preview-container[data-preview-panel-id]';

export function getPreviewPanelIdFromElement(element: Element | null): string | null {
  return element?.closest<HTMLElement>(PREVIEW_CONTAINER_SELECTOR)?.dataset.previewPanelId ?? null;
}

export function getFirstEditablePreviewPanelId(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>('.preview-container[data-preview-editable="true"]')?.dataset.previewPanelId ?? null;
}
