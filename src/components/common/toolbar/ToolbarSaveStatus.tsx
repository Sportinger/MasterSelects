import { useEffect, useState } from 'react';
import { getActiveRepositorySession, getRepositoryLifecycleState, isScratchRepository } from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import './ToolbarSaveStatus.css';

function readStatus() {
  const session = getActiveRepositorySession();
  const lifecycle = getRepositoryLifecycleState();
  if (!session) return lifecycle.error
    ? { phase: 'failed', label: 'Recovery unavailable', detail: lifecycle.error + ' Changes are not saved in this browser.' }
    : { phase: 'saving', label: 'Preparing recovery\u2026', detail: 'Browser recovery is starting. Changes are not saved yet.' };
  const state = session.coordinator.getStatus();
  const local = session.location.kind === 'opfs' ? ' - Browser local' : '';
  if (!session.opening.writable) return { phase: 'unsaved', label: 'Read-only' + local, detail: 'This tab can browse history. Grant folder access or close the other writing tab before editing.' };
  const error = session.client?.error ?? state.error;
  if (error || lifecycle.error) return { phase: 'failed', label: 'Save failed' + local, detail: error?.message ?? lifecycle.error ?? 'Click to retry saving.' };
  if (state.confirmedSequence < state.appliedSequence || state.queuedBytes > 0) return { phase: 'saving', label: 'Saving\u2026' + local, detail: 'Saving your project changes.' };
  if (isScratchRepository()) return { phase: 'saved', label: 'Browser recovery', detail: 'Your project is saved in this browser. Choose Save to select a project folder.' };
  return { phase: 'saved', label: 'Saved' + local, detail: 'Your changes are saved. Press Ctrl+S to save your current workspace too.' };
}

export function ToolbarSaveStatus({ onSave }: { onSave: () => void }) {
  const [status, setStatus] = useState(readStatus);
  useEffect(() => {
    const refresh = () => {
      const next = readStatus();
      setStatus(previous => previous.label === next.label && previous.detail === next.detail ? previous : next);
    };
    const timer = setInterval(refresh, 500);
    return () => clearInterval(timer);
  }, []);
  return (
    <button className="toolbar-save-status" data-phase={status.phase} type="button"
      title={status.detail} disabled={status.phase === 'saving' || status.label.startsWith('Read-only')}
      onPointerUp={event => event.currentTarget.blur()} onClick={onSave}>
      <span aria-hidden="true" className="toolbar-save-status-dot" />
      <span role="status" aria-live="polite">{status.label}</span>
    </button>
  );
}
