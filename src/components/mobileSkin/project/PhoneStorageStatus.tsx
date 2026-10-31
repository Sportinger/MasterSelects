// Compact save indicator for the phone: saved / saving / pending / failed. It reads the same
// repository session state as the desktop ToolbarSaveStatus (polled like there); a tap explains it,
// and a failure is announced with its reason.

import { useEffect, useState } from 'react';
import { PHONE_M1_TEST_IDS } from '../contracts';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  getActiveRepositorySession,
  getRepositoryLifecycleState,
  isScratchRepository,
} from '../../../services/project/repository/lifecycle/editorRepositoryLifecycle';
import { describeBrowserStorageFailure } from '../../../services/project/core/browserStorageFailure';
import { isRepositoryFilesMissingError } from '../../../services/project/repository/contracts';
import { FALLBACK_STORAGE_NOTICE, isBrowserStorageFallbackActive } from '../../../services/project/core/browserStorageRoot';
import { getFolderAccessPause } from '../../../services/project/folderAccess/folderAccessPause';
import './PhoneProject.css';

const POLL_MS = 500;

export type PhoneStoragePhase = 'saved' | 'saving' | 'pending' | 'failed';

export interface PhoneStorageState {
  phase: PhoneStoragePhase;
  label: string;
  detail: string;
}

/** Same decision order as the desktop toolbar's save status, reduced to four phone phases. */
function readPhoneStorageStatus(): PhoneStorageState {
  const session = getActiveRepositorySession();
  const lifecycle = getRepositoryLifecycleState();
  if (!session) {
    return lifecycle.error
      ? {
        phase: 'failed',
        label: 'Not saved',
        detail: `${describeBrowserStorageFailure(lifecycle.error) ?? lifecycle.error} Changes are not saved in this browser.`,
      }
      : { phase: 'saving', label: 'Preparing', detail: 'Browser recovery is starting. Changes are not saved yet.' };
  }
  const state = session.coordinator.getStatus();
  const temporary = session.location.kind === 'opfs' && isBrowserStorageFallbackActive();
  if (!session.opening.writable) {
    return {
      phase: 'pending',
      label: 'Read-only',
      detail: session.opening.recovery.warnings.at(-1) ?? 'This project is open for editing in another tab.',
    };
  }
  if (getFolderAccessPause().project) {
    return { phase: 'pending', label: 'Paused', detail: 'The browser paused storage access. Your changes are kept in this tab.' };
  }
  const error = session.client?.error ?? state.error;
  if (isRepositoryFilesMissingError(error)) return { phase: 'failed', label: 'Files missing',
    detail: 'Files of this project were deleted while it was open, so changes cannot be saved there. Your work is still here: duplicate the project in the project sheet to keep it.' };
  if (error || lifecycle.error) {
    return { phase: 'failed', label: 'Save failed', detail: error?.message ?? lifecycle.error ?? 'Saving failed.' };
  }
  if (state.confirmedSequence < state.appliedSequence || state.queuedBytes > 0) {
    return { phase: 'saving', label: 'Saving', detail: 'Saving your project changes.' };
  }
  if (temporary) return { phase: 'pending', label: 'Temporary', detail: FALLBACK_STORAGE_NOTICE };
  if (isScratchRepository()) {
    return { phase: 'pending', label: 'Recovery', detail: 'Changes are kept as browser recovery until you create a project.' };
  }
  return { phase: 'saved', label: 'Saved', detail: 'Your changes are saved on this device.' };
}

function sameStatus(a: PhoneStorageState, b: PhoneStorageState): boolean {
  return a.phase === b.phase && a.label === b.label && a.detail === b.detail;
}

export function PhoneStorageStatus() {
  const [status, setStatus] = useState(readPhoneStorageStatus);
  const showToast = usePhoneUiStore((state) => state.showToast);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = readPhoneStorageStatus();
      setStatus((previous) => (sameStatus(previous, next) ? previous : next));
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <button
      type="button"
      className="phone-storage-status"
      data-phase={status.phase}
      data-testid={PHONE_M1_TEST_IDS.storageStatus}
      aria-label={`${status.label}. ${status.detail}`}
      onClick={() => showToast(status.detail, status.phase === 'failed' ? 'error' : 'info')}
    >
      <span className="phone-storage-status__dot" aria-hidden="true" />
      <span className="phone-storage-status__label" role="status" aria-live="polite">{status.label}</span>
    </button>
  );
}
