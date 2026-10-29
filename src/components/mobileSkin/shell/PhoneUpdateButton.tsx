// Phone counterpart of the glowing workspace bar brand: a turquoise glowing Update button appears in the
// top bar once a new version is deployed; a tap saves everything and reloads into it (services/appUpdate).
// A running export is never interrupted; the person is asked.

import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useAppUpdateAvailability, useAppUpdateReload } from '../../../hooks/useAppUpdate';
import { PHONE_TEST_IDS } from '../contracts';
import { PhoneIcon } from './phoneIcons';

const PHONE_UPDATE_TEST_IDS = {
  button: 'phone-topbar-update',
  prompt: 'phone-update-prompt',
} as const;

/** Pointer-focus hygiene: a tapped button lets go of focus a frame later; keyboard focus stays. */
function blurAfterPointer(event: PointerEvent<HTMLElement>): void {
  const target = event.currentTarget;
  window.requestAnimationFrame(() => { if (document.activeElement === target) target.blur(); });
}

/** The prompt covers the whole phone like the other notices, not only the top bar it is opened from. */
function OverPhone({ children }: { children: ReactNode }) {
  const root = document.querySelector<HTMLElement>(`[data-testid="${PHONE_TEST_IDS.root}"]`);
  return root ? createPortal(children, root) : children;
}

export function PhoneUpdateButton() {
  const update = useAppUpdateAvailability();
  const { phase, start, updateAfterExport, dismiss } = useAppUpdateReload();
  const primaryRef = useRef<HTMLButtonElement>(null);
  const busy = phase.kind === 'busy';

  useEffect(() => {
    if (phase.kind === 'ask-export' || phase.kind === 'failed') primaryRef.current?.focus({ preventScroll: true });
  }, [phase.kind]);

  // Escape closes the prompt (capture phase, so a sheet underneath keeps its own Escape), not while saving.
  useEffect(() => {
    if (phase.kind === 'idle' || busy) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      dismiss();
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [busy, dismiss, phase.kind]);

  if (!update.available) return null;
  const label = `New version ${update.version ?? 'newer'} available – tap to update`;
  return (
    <>
      <button
        type="button"
        className="phone-icon-button phone-update-button"
        aria-label={label}
        aria-busy={busy || undefined}
        title={label}
        data-testid={PHONE_UPDATE_TEST_IDS.button}
        data-update-available="true"
        onPointerUp={blurAfterPointer}
        onClick={start}
      >
        <PhoneIcon name="update" size={22} />
      </button>
      {phase.kind !== 'idle' && (
        <OverPhone>
          <div className="phone-notice-backdrop" onPointerDown={busy ? undefined : dismiss}>
            <div
              className="phone-notice"
              role={phase.kind === 'ask-export' ? 'alertdialog' : 'status'}
              aria-label="Update to the new version"
              data-testid={PHONE_UPDATE_TEST_IDS.prompt}
              data-update-phase={phase.kind}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <div className="phone-notice__title">Update to {update.version ?? 'the new version'}</div>
              {phase.kind === 'ask-export' && (
                <>
                  <p className="phone-notice__reason">An export is running. Update when it has finished?</p>
                  <div className="phone-update-actions">
                    <button type="button" className="phone-button" onClick={dismiss}>Not now</button>
                    <button ref={primaryRef} type="button" className="phone-button phone-button--primary" onClick={updateAfterExport}>
                      Update after export
                    </button>
                  </div>
                </>
              )}
              {phase.kind === 'busy' && (
                <>
                  <p className="phone-notice__reason">{phase.message}</p>
                  <button type="button" className="phone-button" onClick={dismiss}>Cancel</button>
                </>
              )}
              {phase.kind === 'failed' && (
                <>
                  <p className="phone-notice__reason" role="alert">{phase.message}</p>
                  <button ref={primaryRef} type="button" className="phone-button phone-button--primary" onClick={dismiss}>OK</button>
                </>
              )}
            </div>
          </div>
        </OverPhone>
      )}
    </>
  );
}
