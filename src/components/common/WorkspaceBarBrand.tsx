// The "MasterSelects <version>" brand at the left of the workspace bar. When a new version is deployed
// while the editor is open it glows turquoise and becomes a button: a click saves everything and reloads
// into the new version (services/appUpdate). A running export is never interrupted; the person is asked.

import { useCallback, useEffect, useRef } from 'react';

import { useAppUpdateAvailability, useAppUpdateReload } from '../../hooks/useAppUpdate';
import { APP_VERSION } from '../../version';
import './WorkspaceBarBrand.css';

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

  // The slot is the grid cell in both states, so the bar keeps its columns when the brand turns into a button.
  if (!update.available) {
    return (
      <div className="workspace-bar-brand-slot">
        <div aria-hidden="true" className="workspace-bar-brand"><BrandContent /></div>
      </div>
    );
  }

  const label = `New version ${update.version ?? 'newer'} available – click to update`;
  return (
    <div className="workspace-bar-brand-slot" data-update-available="true" ref={rootRef}>
      <button
        aria-busy={busy || undefined}
        aria-label={label}
        className="workspace-bar-brand workspace-bar-brand--update"
        data-update-version={update.version ?? ''}
        onClick={start}
        onPointerUp={(event) => event.currentTarget.blur()}
        ref={brandRef}
        title={label}
        type="button"
      >
        <BrandContent />
      </button>

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
