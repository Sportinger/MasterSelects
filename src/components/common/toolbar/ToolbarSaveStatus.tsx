import { useEffect, useState } from 'react';
import { projectFileService } from '../../../services/projectFileService';
import { projectSaveStatus } from '../../../services/project/projectSaveStatus';
import './ToolbarSaveStatus.css';

function readStatus() {
  if (!projectFileService.isProjectOpen()) {
    return { phase: 'unsaved', label: 'Not saved to a project', detail: 'Choose Save to create a project.' };
  }
  const identity = projectFileService.getProjectHandle() ?? projectFileService.getProjectPath();
  const status = projectSaveStatus.read(identity);
  const dirty = projectFileService.hasUnsavedChanges();
  const lastSave = status.lastSuccessfulSave
    ? new Date(status.lastSuccessfulSave).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;
  const detail = lastSave ? `Last successful save: ${lastSave}.` : 'No successful save recorded in this session.';
  if (status.saving) return { phase: 'saving', label: 'Saving…', detail };
  if (status.failed) return { phase: 'failed', label: 'Save failed', detail: `${detail} Changes are not safely saved. Click to retry.` };
  if (dirty) return { phase: 'unsaved', label: 'Unsaved changes', detail: `${detail} Click to save.` };
  return { phase: 'saved', label: lastSave ? `Saved ${lastSave}` : 'No unsaved changes', detail };
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
      title={status.detail} disabled={status.phase === 'saving'}
      onPointerUp={event => event.currentTarget.blur()} onClick={onSave}>
      <span aria-hidden="true" className="toolbar-save-status-dot" />
      <span role="status" aria-live="polite">{status.label}</span>
    </button>
  );
}
