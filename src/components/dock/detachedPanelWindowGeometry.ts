import type { BrowserWindowPanel } from '../../types/dock';

export type DetachedPanelWindowBounds = Pick<BrowserWindowPanel, 'position' | 'size'>;

function finitePositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function getDefaultPopupSize(sourceWindow: Window): { width: number; height: number } {
  return {
    width: Math.min(1120, Math.max(760, Math.round(sourceWindow.screen.availWidth * 0.56))),
    height: Math.min(880, Math.max(540, Math.round(sourceWindow.screen.availHeight * 0.72))),
  };
}

function measureSourcePane(
  groupId: string | null,
  sourceDocument: Document,
): { width: number; height: number } | undefined {
  if (!groupId) return undefined;

  const sourcePane = Array.from(
    sourceDocument.querySelectorAll<HTMLElement>('.dock-tab-pane[data-group-id]'),
  ).find((candidate) => candidate.dataset.groupId === groupId);
  if (!sourcePane) return undefined;

  const rect = sourcePane.getBoundingClientRect();
  if (!finitePositive(rect.width) || !finitePositive(rect.height)) return undefined;
  return {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

/**
 * Resolve the popup's first content size during React's render phase, while the
 * source pane still belongs to the committed dock DOM. Persisted bounds win on
 * reload; a newly detached panel starts at the pane's actual rendered size.
 */
export function resolveDetachedPanelInitialBounds(
  windowPanel: BrowserWindowPanel,
  sourceDocument: Document,
): DetachedPanelWindowBounds {
  return {
    position: windowPanel.position,
    size: windowPanel.size ?? measureSourcePane(windowPanel.returnGroupId, sourceDocument),
  };
}

export function buildDetachedPanelWindowFeatures(
  savedBounds: DetachedPanelWindowBounds,
  sourceWindow: Window,
): string {
  const screenWithOffset = sourceWindow.screen as Screen & { availLeft?: number; availTop?: number };
  const fallbackSize = getDefaultPopupSize(sourceWindow);
  const width = finitePositive(savedBounds.size?.width)
    ? Math.round(savedBounds.size.width)
    : fallbackSize.width;
  const height = finitePositive(savedBounds.size?.height)
    ? Math.round(savedBounds.size.height)
    : fallbackSize.height;
  const fallbackLeft = Number(screenWithOffset.availLeft ?? 0)
    + Math.round((sourceWindow.screen.availWidth - width) / 2);
  const fallbackTop = Number(screenWithOffset.availTop ?? 0)
    + Math.round((sourceWindow.screen.availHeight - height) / 2);
  const left = Number.isFinite(savedBounds.position?.left)
    ? Math.round(savedBounds.position!.left)
    : fallbackLeft;
  const top = Number.isFinite(savedBounds.position?.top)
    ? Math.round(savedBounds.position!.top)
    : fallbackTop;

  return [
    'popup=yes',
    'resizable=yes',
    'scrollbars=no',
    `width=${width}`,
    `height=${height}`,
    `left=${left}`,
    `top=${top}`,
  ].join(',');
}

/** Window feature width/height describe the popup content area, so persist the
 * corresponding inner size as well. This prevents browser chrome from making
 * a restored popup grow on every reopen. */
export function getDetachedPanelWindowBounds(
  popup: Window,
): { width: number; height: number; left: number; top: number } | null {
  if (popup.closed) return null;
  const legacyWindow = popup as Window & { screenLeft?: number; screenTop?: number };
  const width = Math.round(popup.innerWidth || popup.outerWidth || 0);
  const height = Math.round(popup.innerHeight || popup.outerHeight || 0);
  const left = Math.round(popup.screenX || legacyWindow.screenLeft || 0);
  const top = Math.round(popup.screenY || legacyWindow.screenTop || 0);
  if (width <= 0 || height <= 0) return null;
  return { width, height, left, top };
}
