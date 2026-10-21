import { useEffect, useRef, useSyncExternalStore } from 'react';
import { describeFolderAccessPause, FOLDER_ACCESS_PAUSED_NOTICE, getFolderAccessPause, subscribeFolderAccessPause } from '../../../services/project/folderAccess/folderAccessPause';
import { resumeFolderAccess } from '../../../services/project/folderAccess/folderAccessResume';
import { startFolderAccessWatch } from '../../../services/project/folderAccess/folderAccessWatch';
import { focusStableToolbarControl } from './toolbarFocusFallback';
import './ToolbarSaveStatus.css';

/** Toolbar state for folder access the browser paused mid-session: one click re-allows it. */
export function ToolbarFolderAccess() {
  const state = useSyncExternalStore(subscribeFolderAccessPause, getFolderAccessPause);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const hadFocus = useRef(false);
  useEffect(() => startFolderAccessWatch(), []);
  // Runs at publish time, before React commits the change, while the button is still mounted.
  useEffect(() => subscribeFolderAccessPause(() => {
    if (rootRef.current?.contains(document.activeElement)) hadFocus.current = true;
  }), []);
  useEffect(() => {
    if (state.paused || !hadFocus.current) return;
    hadFocus.current = false;
    // The focused Re-allow button unmounted after a keyboard activation: keep focus in the toolbar.
    const scope = document.querySelector('.toolbar-right');
    if (scope && (!document.activeElement || document.activeElement === document.body)) focusStableToolbarControl(scope);
  }, [state.paused]);
  if (!state.paused) return null;
  const busy = state.phase === 'resuming';
  const detail = describeFolderAccessPause(state);
  return (
    <span className="toolbar-write-access toolbar-folder-access" ref={rootRef}>
      <span className="toolbar-write-access-notice" role="status" aria-live="polite" title={detail}>
        {FOLDER_ACCESS_PAUSED_NOTICE}
      </span>
      <button className="toolbar-write-access-button" type="button" title={detail} aria-disabled={busy}
        onPointerUp={event => event.currentTarget.blur()}
        // The browser prompt needs this click's user activation: resume starts synchronously here.
        onClick={() => { if (!busy) void resumeFolderAccess(); }}>
        {busy ? 'Allowing…' : 'Re-allow'}
      </button>
    </span>
  );
}
