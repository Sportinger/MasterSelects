import { useLayoutEffect, useState, type RefObject } from 'react';

import type { PreviewPanelData } from '../../types/dock';

type InitialEdit = Pick<PreviewPanelData, 'initialEditMode' | 'initialEditCameraView'>;

/**
 * Hosts outside the dock that want a preview to open as a 3D edit view (like the desktop's
 * 3D workspace previews, FACTORY_3D_EDIT_PREVIEW_DEFAULTS) mark an ancestor element:
 * - `data-preview-initial-edit-view="camera|front|side|top"` on any ancestor, or
 * - the phone's landscape 3D scene editor (`.phone-workspace[data-workspace="scene3d"]`),
 *   which shows the preview as its main area and needs scene orbit/pan/zoom by touch.
 * Dock previews have no such ancestor and keep their own panel data.
 */
const HOST_SELECTOR = '[data-preview-initial-edit-view], .phone-workspace[data-workspace="scene3d"] .phone-workspace__main';
const VIEWS = new Set(['camera', 'front', 'side', 'top']);

export function resolvePreviewHostInitialEdit(element: Element | null): InitialEdit | undefined {
  const host = element?.closest(HOST_SELECTOR);
  if (!host) return undefined;
  const requested = host.closest('[data-preview-initial-edit-view]')?.getAttribute('data-preview-initial-edit-view') ?? 'camera';
  const view = VIEWS.has(requested) ? requested as InitialEdit['initialEditCameraView'] : 'camera';
  return { initialEditMode: true, initialEditCameraView: view };
}

/** Panel data wins; otherwise the hosting element's request (resolved once, before the first paint). */
export function usePreviewHostInitialEdit(
  containerRef: RefObject<HTMLElement | null>,
  initialEdit: InitialEdit | undefined,
): InitialEdit | undefined {
  const [hostInitialEdit, setHostInitialEdit] = useState<InitialEdit | undefined>(undefined);
  useLayoutEffect(() => {
    if (initialEdit?.initialEditMode) return;
    const resolved = resolvePreviewHostInitialEdit(containerRef.current);
    if (resolved) setHostInitialEdit(resolved);
  }, [containerRef, initialEdit?.initialEditMode]);
  return initialEdit?.initialEditMode ? initialEdit : hostInitialEdit ?? initialEdit;
}
