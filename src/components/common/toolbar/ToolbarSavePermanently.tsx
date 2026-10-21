import { resolvePermanentSaveHint, type PermanentSaveHint } from '../../../services/project/permanentSave/permanentSaveOptions';
import type { PermanentSaveStatus } from './usePermanentSaveStatus';
import './SavePermanently.css';

function describeHint(hint: PermanentSaveHint, others: number) {
  if (hint === 'temporary') return {
    badge: 'Temporary', label: 'Save permanently', short: 'Save',
    title: 'This project is only in temporary browser storage and can be lost when the window closes. Click to save it permanently.',
  };
  if (hint === 'not-safe') return {
    badge: 'Not safe yet', label: 'Keep safe', short: 'Keep safe',
    title: 'Safari deletes this browser storage after seven days without a visit. Click to add MasterSelects to the Home Screen and take this project along.',
  };
  return {
    badge: 'Temporary', label: `Move ${others} temporary project${others === 1 ? '' : 's'}`, short: 'Move',
    title: 'Projects from an earlier session are still in temporary browser storage. Click to move them into permanent storage.',
  };
}

/**
 * Prominent toolbar action while the open project is only in temporary browser
 * storage, while an iPhone/iPad Safari tab holds it in storage Safari may evict,
 * or while projects left in temporary storage can move into permanent storage.
 */
export function ToolbarSavePermanently({ status, onOpen }: { status: PermanentSaveStatus; onOpen(): void }) {
  const hint = resolvePermanentSaveHint(status);
  if (!hint) return null;
  const { badge, label, short, title } = describeHint(hint, status.temporaryProjects.length);
  return (
    <button className="toolbar-save-permanently" type="button" title={title} aria-label={`${label}: ${title}`}
      data-active-temporary={status.activeTemporary ? 'true' : 'false'} data-hint={hint}
      onPointerUp={event => event.currentTarget.blur()} onClick={onOpen}>
      <span className="toolbar-save-permanently-badge" aria-hidden="true">{badge}</span>
      <span className="toolbar-save-permanently-label">{label}</span>
      <span className="toolbar-save-permanently-short" aria-hidden="true">{short}</span>
    </button>
  );
}
