import { cleanupPersistedBrowserWindowPanels } from '../../stores/dockStore/layoutPersistence';
import { findGroupIdByPanelId } from '../../stores/dockStore/layoutTree';
import type { BrowserWindowPanel, DockLayout } from '../../types/dock';
import { collapseSingleChildSplits, removePanel } from '../../utils/dockLayout';

const DETACHED_PANEL_REFRESH_KEY = 'masterselects.detached-panels.refresh-v1';

type RefreshStorage = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;
type MeasuredPopupBounds = {
  width: number;
  height: number;
  left: number;
  top: number;
};

function readRefreshPanels(storage: RefreshStorage): BrowserWindowPanel[] {
  try {
    const raw = storage.getItem(DETACHED_PANEL_REFRESH_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const candidates = parsed.filter((candidate): candidate is BrowserWindowPanel => (
      typeof candidate === 'object'
      && candidate !== null
      && typeof (candidate as BrowserWindowPanel).id === 'string'
      && typeof (candidate as BrowserWindowPanel).panel === 'object'
      && (candidate as BrowserWindowPanel).panel !== null
    ));
    return cleanupPersistedBrowserWindowPanels(candidates);
  } catch {
    return [];
  }
}

export function rememberDetachedPanelForRefresh(
  windowPanel: BrowserWindowPanel,
  bounds: MeasuredPopupBounds | null,
  storage: RefreshStorage,
): void {
  try {
    const refreshedPanel: BrowserWindowPanel = {
      ...windowPanel,
      position: bounds
        ? { left: bounds.left, top: bounds.top }
        : windowPanel.position,
      size: bounds
        ? { width: bounds.width, height: bounds.height }
        : windowPanel.size,
    };
    const existing = readRefreshPanels(storage)
      .filter((candidate) => candidate.id !== refreshedPanel.id);
    storage.setItem(
      DETACHED_PANEL_REFRESH_KEY,
      JSON.stringify([...existing, refreshedPanel]),
    );
  } catch {
    // sessionStorage can be unavailable in hardened/private browser modes.
  }
}

export function takeDetachedPanelsForRefresh(storage: RefreshStorage): BrowserWindowPanel[] {
  const panels = readRefreshPanels(storage);
  try {
    storage.removeItem(DETACHED_PANEL_REFRESH_KEY);
  } catch {
    // Treat inaccessible storage as an empty one-shot handoff.
  }
  return panels;
}

export function applyDetachedPanelRefreshState(
  layout: DockLayout,
  currentPanels: readonly BrowserWindowPanel[],
  refreshPanels: readonly BrowserWindowPanel[],
): { layout: DockLayout; browserWindowPanels: BrowserWindowPanel[] } {
  if (refreshPanels.length === 0) {
    return { layout, browserWindowPanels: [...currentPanels] };
  }

  const refreshIds = new Set(refreshPanels.map((candidate) => candidate.id));
  const browserWindowPanels = [
    ...currentPanels.filter((candidate) => !refreshIds.has(candidate.id)),
    ...refreshPanels,
  ];
  const detachedPanelIds = new Set(browserWindowPanels.map((candidate) => candidate.panel.id));
  let nextLayout: DockLayout = {
    ...layout,
    floatingPanels: layout.floatingPanels.filter(
      (floating) => !detachedPanelIds.has(floating.panel.id),
    ),
  };

  for (const panelId of detachedPanelIds) {
    const groupId = findGroupIdByPanelId(nextLayout.root, panelId);
    if (!groupId) continue;
    const layoutWithoutPanel = removePanel(nextLayout, panelId, groupId);
    nextLayout = {
      ...layoutWithoutPanel,
      root: collapseSingleChildSplits(layoutWithoutPanel.root),
    };
  }

  return { layout: nextLayout, browserWindowPanels };
}
