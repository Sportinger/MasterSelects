import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDockStore } from '../../stores/dockStore';
import type { BrowserWindowPanel } from '../../types/dock';
import { DockPanelContent } from './DockPanelContent';
import {
  buildDetachedPanelWindowFeatures,
  getDetachedPanelWindowBounds,
  resolveDetachedPanelInitialBounds,
} from './detachedPanelWindowGeometry';
import { rememberDetachedPanelForRefresh } from './detachedPanelRefreshState';

interface DetachedPanelWindowProps {
  windowPanel: BrowserWindowPanel;
  restoreReady?: boolean;
}

function syncTheme(targetDocument: Document): void {
  targetDocument.documentElement.className = document.documentElement.className;
  targetDocument.documentElement.style.cssText = document.documentElement.style.cssText;
  for (const [key, value] of Object.entries(document.documentElement.dataset)) {
    if (typeof value === 'string') {
      targetDocument.documentElement.dataset[key] = value;
    }
  }
}

function syncStyles(targetDocument: Document): void {
  targetDocument.head
    .querySelectorAll('[data-detached-panel-window-style]')
    .forEach((node) => node.remove());

  document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    const clone = node.cloneNode(true) as HTMLElement;
    clone.dataset.detachedPanelWindowStyle = 'true';
    targetDocument.head.appendChild(clone);
  });
}

function createWindowDocument(popup: Window, title: string): HTMLElement | null {
  popup.document.open();
  popup.document.write(`<!doctype html>
<html>
  <head>
    <title></title>
  </head>
  <body>
    <div id="detached-panel-window-root"></div>
  </body>
</html>`);
  popup.document.close();
  popup.document.title = title;
  popup.document.body.style.margin = '0';
  popup.document.body.style.overflow = 'hidden';
  syncTheme(popup.document);
  syncStyles(popup.document);
  return popup.document.getElementById('detached-panel-window-root');
}

function detachWindowOpener(popup: Window): void {
  popup.opener = null;
}

export function DetachedPanelWindow({
  windowPanel,
  restoreReady = true,
}: DetachedPanelWindowProps) {
  const dockBrowserWindowPanel = useDockStore((state) => state.dockBrowserWindowPanel);
  const updateBrowserWindowPanelSize = useDockStore((state) => state.updateBrowserWindowPanelSize);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const [openBlocked, setOpenBlocked] = useState(false);
  const [popupAttempt, setPopupAttempt] = useState(0);
  const [popupWindow, setPopupWindow] = useState<Window | null>(null);
  const popupRef = useRef<Window | null>(null);
  const closingFromAppRef = useRef(false);
  const windowPanelRef = useRef(windowPanel);
  windowPanelRef.current = windowPanel;
  const initialBoundsRef = useRef(resolveDetachedPanelInitialBounds(windowPanel, document));
  const lastBoundsRef = useRef<Pick<BrowserWindowPanel, 'position' | 'size'>>({
    position: windowPanel.position,
    size: windowPanel.size,
  });

  const dockBack = useCallback(() => {
    closingFromAppRef.current = true;
    dockBrowserWindowPanel(windowPanel.id);
    popupRef.current?.close();
  }, [dockBrowserWindowPanel, windowPanel.id]);

  const requestPopup = useCallback(() => window.open(
    '',
    `masterselects_panel_${windowPanel.id}`,
    buildDetachedPanelWindowFeatures(initialBoundsRef.current, window),
  ), [windowPanel.id]);

  const retryPopupFromUserGesture = useCallback(() => {
    const popup = requestPopup();
    if (!popup) {
      setOpenBlocked(true);
      return;
    }
    popupRef.current = popup;
    setOpenBlocked(false);
    setPopupAttempt((attempt) => attempt + 1);
  }, [requestPopup]);

  useEffect(() => {
    closingFromAppRef.current = false;

    const requestedPopup = popupRef.current;
    const popup = requestedPopup && !requestedPopup.closed
      ? requestedPopup
      : requestPopup();
    if (!popup) {
      // A restored window is opened after project hydration, outside the
      // original user gesture. Chrome may block that attempt. Keep the
      // persisted detached state intact so a later retry can restore it.
      setOpenBlocked(true);
      return undefined;
    }

    setOpenBlocked(false);
    detachWindowOpener(popup);
    popupRef.current = popup;
    setPopupWindow(popup);

    const handleMainUnload = () => {
      const bounds = getDetachedPanelWindowBounds(popup);
      rememberDetachedPanelForRefresh(windowPanelRef.current, bounds, window.sessionStorage);
      if (bounds) updateBrowserWindowPanelSize(windowPanel.id, bounds);
      closingFromAppRef.current = true;
      popup.close();
    };

    const styleObserver = new MutationObserver(() => {
      if (!popup.closed) {
        syncTheme(popup.document);
        syncStyles(popup.document);
      }
    });
    const themeObserver = new MutationObserver(() => {
      if (!popup.closed) {
        syncTheme(popup.document);
      }
    });
    styleObserver.observe(document.head, { childList: true, subtree: true });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });

    window.addEventListener('beforeunload', handleMainUnload);
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !closingFromAppRef.current) {
        closingFromAppRef.current = true;
        dockBrowserWindowPanel(windowPanel.id);
      }
    }, 500);
    const sizePoll = window.setInterval(() => {
      const bounds = getDetachedPanelWindowBounds(popup);
      if (!bounds) return;
      const previousSize = lastBoundsRef.current.size;
      const previousPosition = lastBoundsRef.current.position;
      if (
        !previousSize ||
        !previousPosition ||
        Math.abs(previousSize.width - bounds.width) > 2 ||
        Math.abs(previousSize.height - bounds.height) > 2 ||
        Math.abs(previousPosition.left - bounds.left) > 2 ||
        Math.abs(previousPosition.top - bounds.top) > 2
      ) {
        lastBoundsRef.current = {
          position: { left: bounds.left, top: bounds.top },
          size: { width: bounds.width, height: bounds.height },
        };
        updateBrowserWindowPanelSize(windowPanel.id, bounds);
      }
    }, 1000);

    return () => {
      closingFromAppRef.current = true;
      styleObserver.disconnect();
      themeObserver.disconnect();
      window.clearInterval(closedPoll);
      window.clearInterval(sizePoll);
      window.removeEventListener('beforeunload', handleMainUnload);
      const bounds = getDetachedPanelWindowBounds(popup);
      if (bounds) updateBrowserWindowPanelSize(windowPanel.id, bounds);
      popupRef.current = null;
    };
  }, [
    dockBrowserWindowPanel,
    popupAttempt,
    requestPopup,
    updateBrowserWindowPanelSize,
    windowPanel.id,
    windowPanel.panel.title,
  ]);

  useEffect(() => {
    if (!restoreReady || !popupWindow || popupWindow.closed) return undefined;

    const root = createWindowDocument(
      popupWindow,
      `${windowPanel.panel.title} - MasterSelects`,
    );
    const portalRootTimer = window.setTimeout(() => setPortalRoot(root), 0);
    popupWindow.focus();

    return () => {
      window.clearTimeout(portalRootTimer);
    };
  }, [popupWindow, restoreReady, windowPanel.panel.title]);

  if (!portalRoot) {
    if (openBlocked) {
      return (
        <div
          role="status"
          style={{
            position: 'fixed',
            zIndex: 100000,
            top: 72,
            right: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            maxWidth: 360,
            padding: '10px 12px',
            border: '1px solid var(--border-color, #3f4752)',
            borderRadius: 8,
            background: 'var(--panel-bg, #20242a)',
            color: 'var(--text-primary, #f3f5f7)',
            boxShadow: '0 12px 32px rgb(0 0 0 / 45%)',
          }}
        >
          <span>{windowPanel.panel.title} window was blocked by the browser.</span>
          <button type="button" onClick={retryPopupFromUserGesture}>
            Restore {windowPanel.panel.title} window
          </button>
        </div>
      );
    }
    return null;
  }

  return createPortal(
    <div className="detached-panel-window-shell">
      <header className="detached-panel-window-header">
        <div className="detached-panel-window-title">
          <span>Panel Window</span>
          <strong>{windowPanel.panel.title}</strong>
        </div>
        <button
          className="detached-panel-window-dock-button"
          type="button"
          onClick={dockBack}
        >
          Dock back
        </button>
      </header>
      <main className="detached-panel-window-content">
        <div
          data-detached-panel-content-host
          style={{
            flex: '1 1 0',
            width: '100%',
            height: '100%',
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
          }}
        >
          <DockPanelContent panel={windowPanel.panel} />
        </div>
      </main>
    </div>,
    portalRoot
  );
}
