import { shouldOfferPermanentSave } from '../../../services/project/permanentSave/permanentSaveOptions';
import type { PermanentSaveStatus } from './usePermanentSaveStatus';
import './SavePermanently.css';

/**
 * Prominent toolbar action while the open project is only in temporary browser
 * storage, or while projects left there can move into permanent storage.
 */
export function ToolbarSavePermanently({ status, onOpen }: { status: PermanentSaveStatus; onOpen(): void }) {
  if (!shouldOfferPermanentSave(status)) return null;
  const others = status.temporaryProjects.length;
  const label = status.activeTemporary ? 'Save permanently' : `Move ${others} temporary project${others === 1 ? '' : 's'}`;
  const title = status.activeTemporary
    ? 'This project is only in temporary browser storage and can be lost when the window closes. Click to save it permanently.'
    : 'Projects from an earlier session are still in temporary browser storage. Click to move them into permanent storage.';
  return (
    <button className="toolbar-save-permanently" type="button" title={title} aria-label={`${label}: ${title}`}
      data-active-temporary={status.activeTemporary ? 'true' : 'false'}
      onPointerUp={event => event.currentTarget.blur()} onClick={onOpen}>
      <span className="toolbar-save-permanently-badge" aria-hidden="true">Temporary</span>
      <span className="toolbar-save-permanently-label">{label}</span>
      <span className="toolbar-save-permanently-short" aria-hidden="true">{status.activeTemporary ? 'Save' : 'Move'}</span>
    </button>
  );
}
