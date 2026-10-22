import { useEffect, useRef, useState } from 'react';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { getEditorWriterHandover, takeOverEditing } from '../../../services/project/repository/lifecycle/editorWriterHandover';
import { HANDOVER_STALE_NOTICE, type WriterHandoverState } from '../../../services/project/repository/lifecycle/writerHandover';
import { focusStableToolbarControl } from './toolbarFocusFallback';
import './ToolbarSaveStatus.css';

interface WriteAccessView { label: string; detail: string; busy: boolean; notice: string | null; stale: boolean }

const BUSY_LABELS: Partial<Record<WriterHandoverState['phase'], string>> = {
  requesting: 'Asking other tab…', reopening: 'Reopening…', releasing: 'Handing over…', reloading: 'Reloading…',
};
function describeWriter(state: WriterHandoverState): string {
  if (state.writer) {
    const since = new Date(state.writer.since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return `Another tab has been editing this project since ${since}${state.writer.visible ? '' : ' (it is in the background)'}.`;
  }
  if (state.writerLockHeld === false) return 'No other tab is editing this project; this tab opened it without write access.';
  return 'Another tab of this browser is editing this project.';
}

/** Null when this tab writes, nothing is open, or the project can only be made writable by Copy/Restore. */
function readView(): WriteAccessView | null {
  const session = getActiveRepositorySession();
  if (!session || session.opening.writable || session.opening.ownershipReason) return null;
  const state = getEditorWriterHandover().getSnapshot();
  const free = state.writerLockHeld === false;
  const action = free
    ? 'Enable editing reopens the project here with write access.'
    : 'Take over editing makes that tab save its changes and switch to read-only, then this tab can edit.';
  return {
    label: BUSY_LABELS[state.phase] ?? (free ? 'Enable editing' : 'Take over editing'),
    detail: `${describeWriter(state)} ${action}`,
    busy: state.phase in BUSY_LABELS,
    // A newer saved revision outranks the older handover notice.
    notice: state.stale ? HANDOVER_STALE_NOTICE : state.notice,
    stale: state.stale,
  };
}

const sameView = (left: WriteAccessView | null, right: WriteAccessView | null) => left === right
  || (left !== null && right !== null && left.label === right.label && left.detail === right.detail && left.busy === right.busy && left.notice === right.notice && left.stale === right.stale);

/** Read-only indicator action: request the writer lock from the tab that holds it. */
export function ToolbarWriteAccess() {
  const [view, setView] = useState(readView);
  const rootRef = useRef<HTMLSpanElement | null>(null);
  // Toolbar section to keep keyboard focus in when the focused button of this control unmounts.
  const focusFallbackRef = useRef<Element | null>(null);
  useEffect(() => {
    const refresh = () => {
      const next = readView();
      const root = rootRef.current;
      // Remember where focus was right before this update; the effect below needs it after commit.
      focusFallbackRef.current = root?.contains(document.activeElement) ? root.closest('.toolbar-section') ?? root.parentElement : null;
      setView(previous => sameView(previous, next) ? previous : next);
    };
    const unsubscribe = getEditorWriterHandover().subscribe(refresh);
    // The repository session is replaced on reopen; poll like the save status does.
    const timer = setInterval(refresh, 500);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);
  useEffect(() => {
    const scope = focusFallbackRef.current;
    focusFallbackRef.current = null;
    if (!scope || (document.activeElement && document.activeElement !== document.body)) return;
    // The focused button unmounted (keyboard takeover or reload); without this, focus falls to <body>.
    const own = rootRef.current?.querySelector<HTMLButtonElement>('.toolbar-write-access-button:last-of-type');
    if (own) own.focus(); else focusStableToolbarControl(scope);
  }, [view]);
  if (!view) return null;
  // aria-disabled instead of disabled while busy: a disabled button drops keyboard focus.
  const guard = (action: () => void) => () => { if (!view.busy) action(); };
  return (
    <span className="toolbar-write-access" ref={rootRef}>
      {view.notice && <span className="toolbar-write-access-notice" role="status" aria-live="polite" title={view.notice}>{view.notice}</span>}
      {view.stale && (
        <button className="toolbar-write-access-button" type="button" aria-disabled={view.busy}
          title="Load the latest state saved by the tab that is editing. This tab stays read-only."
          onPointerUp={event => event.currentTarget.blur()}
          onClick={guard(() => { void getEditorWriterHandover().reloadLatest(); })}>
          Reload
        </button>
      )}
      <button className="toolbar-write-access-button" type="button" title={view.detail} aria-disabled={view.busy}
        onPointerUp={event => event.currentTarget.blur()}
        onClick={guard(() => { void takeOverEditing(); })}>
        {view.label}
      </button>
    </span>
  );
}
