import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useDockStore } from '../../stores/dockStore';
import type { BrowserWindowPanel } from '../../types/dock';
import { DockPanelContent } from './DockPanelContent';

interface DetachedPanelWindowProps {
  windowPanel: BrowserWindowPanel;
}

function getPopupFeatures(): string {
  const screenWithOffset = window.screen as Screen & { availLeft?: number; availTop?: number };
  const width = Math.min(1120, Math.max(760, Math.round(window.screen.availWidth * 0.56)));
  const height = Math.min(880, Math.max(540, Math.round(window.screen.availHeight * 0.72)));
  const left = Math.max(
    0,
    Number(screenWithOffset.availLeft ?? 0) + Math.round((window.screen.availWidth - width) / 2)
  );
  const top = Math.max(
    0,
    Number(screenWithOffset.availTop ?? 0) + Math.round((window.screen.availHeight - height) / 2)
  );

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

export function DetachedPanelWindow({ windowPanel }: DetachedPanelWindowProps) {
  const dockBrowserWindowPanel = useDockStore((state) => state.dockBrowserWindowPanel);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);
  const popupRef = useRef<Window | null>(null);
  const closingFromAppRef = useRef(false);

  const dockBack = useCallback(() => {
    closingFromAppRef.current = true;
    dockBrowserWindowPanel(windowPanel.id);
    popupRef.current?.close();
  }, [dockBrowserWindowPanel, windowPanel.id]);

  useEffect(() => {
    const popup = window.open('', `masterselects_panel_${windowPanel.id}`, getPopupFeatures());
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

    popup.addEventListener('beforeunload', handlePopupUnload);
    window.addEventListener('beforeunload', handleMainUnload);
    const closedPoll = window.setInterval(() => {
      if (popup.closed && !closingFromAppRef.current) {
        closingFromAppRef.current = true;
        dockBrowserWindowPanel(windowPanel.id);
      }
    }, 500);

    return () => {
      closingFromAppRef.current = true;
      window.clearTimeout(portalRootTimer);
      styleObserver.disconnect();
      themeObserver.disconnect();
      window.clearInterval(closedPoll);
      window.removeEventListener('beforeunload', handleMainUnload);
      popup.removeEventListener('beforeunload', handlePopupUnload);
      if (!popup.closed) {
        popup.close();
      }
      popupRef.current = null;
    };
  }, [dockBrowserWindowPanel, windowPanel.id, windowPanel.panel.title]);

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
