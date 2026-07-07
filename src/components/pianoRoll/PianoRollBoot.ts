// Bootstrap a detached piano-roll editor window for a MIDI clip (issue #182).
//
// Modeled on OutputManagerBoot: a same-origin popup shares the JS heap, so the
// piano roll reads/writes the same Zustand timeline store and (later) drives the
// same audio engine directly — no cross-window messaging needed. One window per
// MIDI clip, keyed by clip id, so several clips can be edited side by side.

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { PianoRoll } from './PianoRoll';
import { useTimelineStore } from '../../stores/timeline';

interface PianoRollWindow {
  win: Window;
  root: Root;
}

const openWindows = new Map<string, PianoRollWindow>();

function shouldTransferPopupFocus(): boolean {
  return !useTimelineStore.getState().isPlaying;
}

function injectPianoRollUI(win: Window, clipId: string): void {
  win.document.title = 'Piano Roll';

  // Clear existing DOM (matters if the browser reused a named window).
  win.document.head.innerHTML = '';
  win.document.body.innerHTML = '';

  // Mirror every stylesheet link from the host document so app CSS variables
  // (theme colors etc.) resolve inside the popup.
  document.querySelectorAll('link[rel="stylesheet"]').forEach((node) => {
    const source = node as HTMLLinkElement;
    const link = win.document.createElement('link');
    link.rel = 'stylesheet';
    link.href = source.href;
    win.document.head.appendChild(link);
  });

  win.document.body.style.cssText =
    'margin:0;padding:0;background:#0f0f0f;color:#d4d4d4;font-family:system-ui,-apple-system,sans-serif;font-size:13px;overflow:hidden;';

  const root = win.document.createElement('div');
  root.id = 'piano-roll-root';
  root.style.cssText = 'width:100vw;height:100vh;';
  win.document.body.appendChild(root);

  const reactRoot = createRoot(root);
  reactRoot.render(createElement(PianoRoll, { clipId }));
  openWindows.set(clipId, { win, root: reactRoot });

  win.addEventListener('beforeunload', () => {
    reactRoot.unmount();
    openWindows.delete(clipId);
  });

  if (shouldTransferPopupFocus()) {
    window.blur();
    win.focus();
    win.setTimeout(() => win.focus(), 50);
  }
}

/** Open (or focus the existing) piano-roll window for the given MIDI clip. */
export function openPianoRoll(clipId: string): void {
  const existing = openWindows.get(clipId);
  if (existing && !existing.win.closed) {
    existing.win.focus();
    return;
  }
  if (existing) {
    openWindows.delete(clipId);
  }

  const width = 900;
  const height = 520;
  const left = Math.round(window.screenX + (window.outerWidth - width) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - height) / 2);

  const win = window.open(
    '',
    `piano_roll_${clipId}`,
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
  );

  if (!win) {
    console.error('Failed to open Piano Roll (popup blocked?)');
    return;
  }

  injectPianoRollUI(win, clipId);
}

/** Close a specific clip's piano-roll window if open. */
export function closePianoRoll(clipId: string): void {
  const existing = openWindows.get(clipId);
  if (existing && !existing.win.closed) {
    existing.win.close();
  }
  openWindows.delete(clipId);
}
