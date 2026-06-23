import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDockStore } from '../../stores/dockStore';
import type { BrowserWindowPanel } from '../../types/dock';
import { DockPanelContent } from './DockPanelContent';

interface DetachedPanelWindowProps {
  windowPanel: BrowserWindowPanel;
}

function getDefaultPopupSize(): { width: number; height: number } {
  return {
    width: Math.min(1120, Math.max(760, Math.round(window.screen.availWidth * 0.56))),
    height: Math.min(880, Math.max(540, Math.round(window.screen.availHeight * 0.72))),
  };
}

function getPopupFeatures(savedBounds?: Pick<BrowserWindowPanel, 'position' | 'size'>): string {
  const screenWithOffset = window.screen as Screen & { availLeft?: number; availTop?: number };
  const fallbackSize = getDefaultPopupSize();
  const width = savedBounds?.size ? Math.max(320, Math.round(savedBounds.size.width)) : fallbackSize.width;
  const height = savedBounds?.size ? Math.max(240, Math.round(savedBounds.size.height)) : fallbackSize.height;
  const fallbackLeft = Number(screenWithOffset.availLeft ?? 0) + Math.round((window.screen.availWidth - width) / 2);
  const fallbackTop = Number(screenWithOffset.availTop ?? 0) + Math.round((window.screen.availHeight - height) / 2);
  const left = savedBounds?.position ? Math.round(savedBounds.position.left) : fallbackLeft;
  const top = savedBounds?.position ? Math.round(savedBounds.position.top) : fallbackTop;

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

function getWindowBounds(popup: Window): { width: number; height: number; left: number; top: number } | null {
  if (popup.closed) return null;
  const legacyWindow = popup as Window & { screenLeft?: number; screenTop?: number };
  const width = Math.round(popup.outerWidth || popup.innerWidth || 0);
  const height = Math.round(popup.outerHeight || popup.innerHeight || 0);
  const left = Math.round(popup.screenX || legacyWindow.screenLeft || 0);
  const top = Math.round(popup.screenY || legacyWindow.screenTop || 0);
  if (width <= 0 || height <= 0) return null;
  return { width, height, left, top };
}

export function DetachedPanelWindow({ windowPanel }: DetachedPanelWindowProps) {
  const dockBrowserWindowPanel = useDockStore((state) => state.dockBrowserWindowPanel);
  const updateBrowserWindowPanelSize = useDockStore((state) => state.updateBrowserWindowPanelSize);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const closingFromAppRef = useRef(false);
  const mainUnloadingRef = useRef(false);
  const initialBoundsRef = useRef<Pick<BrowserWindowPanel, 'position' | 'size'>>({
    position: windowPanel.position,
    size: windowPanel.size,
  });
  const lastBoundsRef = useRef<Pick<BrowserWindowPanel, 'position' | 'size'>>({
    position: windowPanel.position,
    size: windowPanel.size,
  });

  const dockBack = useCallback(() => {
    closingFromAppRef.current = true;
    dockBrowserWindowPanel(windowPanel.id);
    popupRef.current?.close();
  }, [dockBrowserWindowPanel, windowPanel.id]);

  useEffect(() => {
    closingFromAppRef.current = false;
    mainUnloadingRef.current = false;

    const popup = window.open('', `masterselects_panel_${windowPanel.id}`, getPopupFeatures(initialBoundsRef.current));
    if (!popup) {
      dockBrowserWindowPanel(windowPanel.id);
      return undefined;
    }

    popup.opener = null;
    popupRef.current = popup;
    const root = createWindowDocument(popup, `${windowPanel.panel.title} - MasterSelects`);
    const portalRootTimer = window.setTimeout(() => setPortalRoot(root), 0);
    popup.focus();

    const handlePopupUnload = () => {
      if (!closingFromAppRef.current) {
        closingFromAppRef.current = true;
        dockBrowserWindowPanel(windowPanel.id);
      }
    };
    const handleMainUnload = () => {
      const bounds = getWindowBounds(popup);
      if (bounds) updateBrowserWindowPanelSize(windowPanel.id, bounds);
      mainUnloadingRef.current = true;
      closingFromAppRef.current = true;
      popup.removeEventListener('beforeunload', handlePopupUnload);
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

    popup.addEventListener('beforeunload', handlePopupUnload);
    window.addEventListener('beforeunload', handleMainUnload);
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !closingFromAppRef.current) {
        closingFromAppRef.current = true;
        dockBrowserWindowPanel(windowPanel.id);
      }
    }, 500);
    const sizePoll = window.setInterval(() => {
      const bounds = getWindowBounds(popup);
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
      window.clearTimeout(portalRootTimer);
      styleObserver.disconnect();
      themeObserver.disconnect();
      window.clearInterval(closedPoll);
      window.clearInterval(sizePoll);
      window.removeEventListener('beforeunload', handleMainUnload);
      popup.removeEventListener('beforeunload', handlePopupUnload);
      const bounds = getWindowBounds(popup);
      if (bounds) updateBrowserWindowPanelSize(windowPanel.id, bounds);
      popupRef.current = null;
    };
  }, [dockBrowserWindowPanel, updateBrowserWindowPanelSize, windowPanel.id, windowPanel.panel.title]);

  if (!portalRoot) {
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
        <DockPanelContent panel={windowPanel.panel} />
      </main>
    </div>,
    portalRoot
  );
}
