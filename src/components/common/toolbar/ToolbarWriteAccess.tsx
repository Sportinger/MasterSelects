import { useEffect, useState } from 'react';
import { getActiveRepositorySession } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { getEditorWriterHandover, takeOverEditing } from '../../../services/project/repository/lifecycle/editorWriterHandover';
import type { WriterHandoverState } from '../../../services/project/repository/lifecycle/writerHandover';
import './ToolbarSaveStatus.css';

interface WriteAccessView { label: string; detail: string; busy: boolean; notice: string | null }

const BUSY_LABELS: Partial<Record<WriterHandoverState['phase'], string>> = {
  requesting: 'Asking other tab…', reopening: 'Reopening…', releasing: 'Handing over…',
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
    notice: state.notice,
  };
}

const sameView = (left: WriteAccessView | null, right: WriteAccessView | null) => left === right
  || (left !== null && right !== null && left.label === right.label && left.detail === right.detail && left.busy === right.busy && left.notice === right.notice);

/** Read-only indicator action: request the writer lock from the tab that holds it. */
export function ToolbarWriteAccess() {
  const [view, setView] = useState(readView);
  useEffect(() => {
    const refresh = () => { const next = readView(); setView(previous => sameView(previous, next) ? previous : next); };
    const unsubscribe = getEditorWriterHandover().subscribe(refresh);
    // The repository session is replaced on reopen; poll like the save status does.
    const timer = setInterval(refresh, 500);
    return () => { unsubscribe(); clearInterval(timer); };
  }, []);
  if (!view) return null;
  return (
    <span className="toolbar-write-access">
      {view.notice && <span className="toolbar-write-access-notice" role="status" aria-live="polite" title={view.notice}>{view.notice}</span>}
      <button className="toolbar-write-access-button" type="button" title={view.detail} disabled={view.busy}
        onPointerUp={event => event.currentTarget.blur()}
        onClick={() => { void takeOverEditing(); }}>
        {view.label}
      </button>
    </span>
  );
}
