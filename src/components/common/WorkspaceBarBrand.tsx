// The "MasterSelects <version>" brand at the left of the workspace bar. A click checks for a new version
// right away and says the answer in a small note above the brand. When a new version is deployed while the
// editor is open the brand glows turquoise: a click then saves everything and reloads into the new version
// (services/appUpdate). A running export is never interrupted; the person is asked.

import { useCallback, useEffect, useRef } from 'react';

import {
  useAppUpdateAvailability, useAppUpdateManualCheck, useAppUpdateReload, type AppUpdateCheckFeedback,
} from '../../hooks/useAppUpdate';
import { APP_VERSION } from '../../version';
import './WorkspaceBarBrand.css';

const CHECK_FEEDBACK_TEXT: Record<AppUpdateCheckFeedback['kind'], string> = {
  idle: '',
  checking: 'Checking…',
  current: `Up to date (${APP_VERSION})`,
  failed: 'Check failed',
  disabled: 'Update checks are off',
};

function BrandContent() {
  return (
    <>
      <span aria-hidden="true" className="workspace-bar-brand-mark">M</span>
      <span aria-hidden="true" className="workspace-bar-brand-label">
        MasterSelects <span className="workspace-bar-brand-version">{APP_VERSION}</span>
      </span>
    </>
  );
}

export function WorkspaceBarBrand() {
  const update = useAppUpdateAvailability();
  const { phase, start, updateAfterExport, dismiss } = useAppUpdateReload();
  const { feedback, checkNow } = useAppUpdateManualCheck();
  const rootRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLButtonElement>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const promptOpen = phase.kind !== 'idle';
  const busy = phase.kind === 'busy';

  useEffect(() => {
    if (phase.kind === 'ask-export' || phase.kind === 'failed') primaryRef.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  // Keyboard focus inside the prompt returns to the brand when the prompt closes (a pointer leaves none).
  const close = useCallback(() => {
    const focusInside = rootRef.current?.contains(document.activeElement) ?? false;
    dismiss();
    if (focusInside) brandRef.current?.focus({ preventScroll: true });
  }, [dismiss]);

  useEffect(() => {
    if (!promptOpen || busy) return undefined;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) dismiss();
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [busy, close, dismiss, promptOpen]);

  // One button in both states, so keyboard focus stays on it when a check finds a new version. The slot is
  // the grid cell and the note floats above it, so the bar keeps its columns.
  const available = update.available;
  const label = available
    ? `New version ${update.version ?? 'newer'} available – click to update`
    : `MasterSelects ${APP_VERSION} – check for updates`;
  const note = available ? '' : CHECK_FEEDBACK_TEXT[feedback.kind];
  return (
    <div className="workspace-bar-brand-slot" data-update-available={available ? 'true' : undefined} ref={rootRef}>
      <button
        aria-busy={(available ? busy : feedback.kind === 'checking') || undefined}
        aria-label={label}
        className={`workspace-bar-brand workspace-bar-brand--button${available ? ' workspace-bar-brand--update' : ''}`}
        data-update-version={available ? update.version ?? '' : undefined}
        onClick={available ? start : checkNow}
        onPointerUp={(event) => event.currentTarget.blur()}
        ref={brandRef}
        title={label}
        type="button"
      >
        <BrandContent />
      </button>

      {/* Always mounted, so screen readers announce each new answer. */}
      <span className="workspace-bar-brand-check" data-check-state={available ? 'idle' : feedback.kind} role="status">{note}</span>

      {promptOpen && (
        <div
          aria-label="Update to the new version"
          className="workspace-bar-update-prompt"
          data-update-phase={phase.kind}
          role={phase.kind === 'ask-export' ? 'alertdialog' : 'status'}
        >
          {phase.kind === 'ask-export' && (
            <>
              <p>An export is running. Update when it has finished?</p>
              <div className="workspace-bar-update-actions">
                <button onClick={updateAfterExport} onPointerUp={(event) => event.currentTarget.blur()} ref={primaryRef} type="button">
                  Update after export
                </button>
                <button onClick={close} onPointerUp={(event) => event.currentTarget.blur()} type="button">Not now</button>
              </div>
            </>
          )}
          {phase.kind === 'busy' && (
            <>
              <p>{phase.message}</p>
              <div className="workspace-bar-update-actions">
                <button onClick={close} onPointerUp={(event) => event.currentTarget.blur()} type="button">Cancel</button>
              </div>
            </>
          )}
          {phase.kind === 'failed' && (
            <>
              <p role="alert">{phase.message}</p>
              <div className="workspace-bar-update-actions">
                <button onClick={close} onPointerUp={(event) => event.currentTarget.blur()} ref={primaryRef} type="button">Close</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
