// Bootstrap function to inject Output Manager React root into a popup window
// Since same-origin popups share the JS heap, all stores and engine work directly
// Supports reconnection after page refresh via named windows

import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { OutputManager } from './OutputManager';
import { useTimelineStore } from '../../stores/timeline';
import { OUTPUT_MANAGER_SHELL_STYLES } from './boot/outputManagerShellStyles';
import { OUTPUT_MANAGER_LIST_STYLES } from './boot/outputManagerListStyles';

let managerWindow: Window | null = null;
const OM_OPEN_KEY = 'masterselects-om-open';

function shouldTransferPopupFocus(): boolean {
  return !useTimelineStore.getState().isPlaying;
}

export function closeOutputManager(): void {
  if (managerWindow && !managerWindow.closed) {
    managerWindow.close();
  }
  managerWindow = null;
  localStorage.removeItem(OM_OPEN_KEY);
}

/**
 * Inject (or re-inject after refresh) the Output Manager UI into a popup window.
 * Clears existing DOM content and mounts fresh React root + styles.
 */
function injectOutputManagerUI(win: Window): void {
  managerWindow = win;
  win.document.title = 'Output Manager';

  // Clear existing DOM (important for reconnection after refresh)
  win.document.head.innerHTML = '';
  win.document.body.innerHTML = '';

  // Inject the main app stylesheet
  const mainStylesheet = document.querySelector('link[rel="stylesheet"]') as HTMLLinkElement | null;
  if (mainStylesheet) {
    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = mainStylesheet.href;
    win.document.head.appendChild(link);
  }

  // Inject Output Manager specific styles
  const style = win.document.createElement('style');
  style.textContent = OUTPUT_MANAGER_SHELL_STYLES + OUTPUT_MANAGER_LIST_STYLES;
  win.document.head.appendChild(style);

  // Set base styles on body
  win.document.body.style.cssText = 'margin:0;padding:0;background:#0f0f0f;color:#d4d4d4;font-family:system-ui,-apple-system,sans-serif;font-size:13px;overflow:hidden;';

  // Create root element
  const root = win.document.createElement('div');
  root.id = 'output-manager-root';
  root.style.cssText = 'width:100vw;height:100vh;';
  win.document.body.appendChild(root);

  // Mount React
  const reactRoot = createRoot(root);
  reactRoot.render(createElement(OutputManager));

  // Mark as open for reconnection after refresh
  localStorage.setItem(OM_OPEN_KEY, '1');

  // Cleanup on close
  win.onbeforeunload = () => {
    reactRoot.unmount();
    managerWindow = null;
    localStorage.removeItem(OM_OPEN_KEY);
  };

  // Avoid stealing focus from the main editor during playback.
  if (shouldTransferPopupFocus()) {
    // Ensure popup gets foreground activation on Windows:
    // Blur the parent first to release foreground lock, then focus the popup
    // from its own context so the OS allows it to become the foreground window.
    window.blur();
    win.focus();
    win.setTimeout(() => win.focus(), 50);
    win.setTimeout(() => win.focus(), 200);
  }
}

export function openOutputManager(): void {
  // If already open, focus it
  if (managerWindow && !managerWindow.closed) {
    managerWindow.focus();
    return;
  }

  const width = 900;
  const height = 600;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

  const win = window.open(
    '',
    'output_manager',
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
  );

  if (!win) {
    console.error('Failed to open Output Manager (popup blocked?)');
    return;
  }

  injectOutputManagerUI(win);
}

/**
 * Try to reconnect to an existing Output Manager popup after page refresh.
 * Returns true if reconnection succeeded.
 */
export function reconnectOutputManager(): boolean {
  // Only attempt reconnection if we know the Output Manager was open before refresh.
  // Without this guard, window.open('', 'output_manager') creates a new blank popup
  // which causes a focus flash and dock tab-switch bug.
  if (!localStorage.getItem(OM_OPEN_KEY)) {
    return false;
  }

  const win = window.open('', 'output_manager');
  if (!win || win.closed) {
    localStorage.removeItem(OM_OPEN_KEY);
    return false;
  }

  // Check if the window has content (means it was previously opened)
  // A freshly created blank popup has about:blank with empty body
  if (win.location.href === 'about:blank' && win.document.body && win.document.body.children.length > 0) {
    // This is our old window — re-inject UI
    injectOutputManagerUI(win);
    return true;
  }

  // It was a fresh blank window we just accidentally created — close it
  if (win !== managerWindow) {
    win.close();
  }
  localStorage.removeItem(OM_OPEN_KEY);
  return false;
}
