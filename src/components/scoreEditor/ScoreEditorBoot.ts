// Bootstrap a detached score-editor window for a score clip (issue #366).
//
// Modeled on PianoRollBoot: a same-origin popup shares the JS heap, so the
// score editor reads/writes the same Zustand timeline store directly — no
// cross-window messaging needed. One window per score clip, keyed by clip id.

import { createRoot, type Root } from 'react-dom/client';
import { createElement } from 'react';
import { ScoreEditor } from './ScoreEditor';
import { useTimelineStore } from '../../stores/timeline';

interface ScoreEditorWindow {
  win: Window;
  root: Root;
}

const openWindows = new Map<string, ScoreEditorWindow>();

function shouldTransferPopupFocus(): boolean {
  return !useTimelineStore.getState().isPlaying;
}

function injectScoreEditorUI(win: Window, clipId: string): void {
  win.document.title = 'Score Editor';

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
  root.id = 'score-editor-root';
  root.style.cssText = 'width:100vw;height:100vh;';
  win.document.body.appendChild(root);

  const reactRoot = createRoot(root);
  reactRoot.render(createElement(ScoreEditor, { clipId }));
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

/** Open (or focus the existing) score-editor window for the given score clip. */
export function openScoreEditor(clipId: string): void {
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
    `score_editor_${clipId}`,
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`,
  );

  if (!win) {
    console.error('Failed to open Score Editor (popup blocked?)');
    return;
  }

  injectScoreEditorUI(win, clipId);
}

/** Close a specific clip's score-editor window if open. */
export function closeScoreEditor(clipId: string): void {
  const existing = openWindows.get(clipId);
  if (existing && !existing.win.closed) {
    existing.win.close();
  }
  openWindows.delete(clipId);
}
