// Renders the sheet for usePhoneUiStore().activeSheet. The sheet is portalled into .phone-shell so
// it sits below the unavailable notice and toast (errors stay visible) and the shell's preview,
// transport and timeline stay mounted underneath: a sheet never unmounts the preview.

import { Component, Suspense, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Logger } from '../../../services/logger';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneSheet } from './PhoneSheet';
import { PhoneSheetIdContext } from './phoneSheetContext';
import { PHONE_SHEET_REGISTRY, isPhoneSheetId } from './phoneSheetRegistry';

const log = Logger.create('PhoneSheetHost');

interface BoundaryProps {
  onError: (error: Error) => void;
  children: ReactNode;
}

/** A sheet chunk that fails to load (offline) or a sheet that throws must say so, not blank. */
class SheetErrorBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    this.props.onError(error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function PhoneSheetHost() {
  const activeSheet = usePhoneUiStore((state) => state.activeSheet);
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [shell, setShell] = useState<HTMLElement | null>(null);

  useLayoutEffect(() => {
    setShell(anchorRef.current?.closest('.mobile-skin')?.querySelector<HTMLElement>('.phone-shell') ?? null);
  }, [activeSheet]);

  const known = isPhoneSheetId(activeSheet);
  useEffect(() => {
    if (activeSheet === null || known) return;
    log.error('Unknown sheet id', { activeSheet });
    showToast(`Sheet "${activeSheet}" does not exist.`, 'error');
    closeSheet();
  }, [activeSheet, known, showToast, closeSheet]);

  const handleError = (error: Error) => {
    log.error('Sheet failed', { activeSheet, error });
    showToast(`Could not open this sheet: ${error.message}`, 'error');
    closeSheet();
  };

  const Sheet = known ? PHONE_SHEET_REGISTRY[activeSheet] : null;
  return (
    <>
      <span ref={anchorRef} hidden />
      {shell && Sheet && activeSheet
        ? createPortal(
            <PhoneSheetIdContext.Provider value={activeSheet}>
              <SheetErrorBoundary key={activeSheet} onError={handleError}>
                <Suspense
                  fallback={
                    <PhoneSheet title="Loading" onCancel={closeSheet} loading>
                      <p className="phone-sheet__loading">Loading…</p>
                    </PhoneSheet>
                  }
                >
                  <Sheet />
                </Suspense>
              </SheetErrorBoundary>
            </PhoneSheetIdContext.Provider>,
            shell,
          )
        : null}
    </>
  );
}
