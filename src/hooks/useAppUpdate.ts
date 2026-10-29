// Shared state of "a new version is deployed" for the workspace bar brand (desktop) and the phone top bar.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { getAppUpdateChecker, retainAppUpdateChecker, type AppUpdateSnapshot } from '../services/appUpdate/appUpdateCheck';
import { reloadForAppUpdate } from '../services/appUpdate/reloadForAppUpdate';

/** Whether the server serves another build; keeps the background check running while mounted. */
export function useAppUpdateAvailability(): AppUpdateSnapshot {
  const checker = getAppUpdateChecker();
  useEffect(() => retainAppUpdateChecker(), []);
  return useSyncExternalStore(checker.subscribe, checker.getSnapshot, checker.getSnapshot);
}

const STILL_HERE_AFTER_RELOAD_MS = 8000;

export type AppUpdateReloadPhase =
  | { kind: 'idle' }
  /** An export is running: update after it, or not now. */
  | { kind: 'ask-export' }
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string };

export interface AppUpdateReloadControls {
  phase: AppUpdateReloadPhase;
  /** Saves everything and reloads; asks first while an export runs. */
  start(): void;
  /** Waits for the running export, then saves and reloads. */
  updateAfterExport(): void;
  /** Stops waiting (a save already running still finishes) and closes the prompt. */
  dismiss(): void;
}

export function useAppUpdateReload(): AppUpdateReloadControls {
  const [phase, setPhase] = useState<AppUpdateReloadPhase>({ kind: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  const stillHereTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    controllerRef.current?.abort();
    if (stillHereTimerRef.current !== null) clearTimeout(stillHereTimerRef.current);
  }, []);

  const run = useCallback(async (waitForExport: boolean) => {
    if (controllerRef.current) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    const update = (next: AppUpdateReloadPhase) => { if (!controller.signal.aborted) setPhase(next); };
    update({ kind: 'busy', message: 'Saving the project…' });
    try {
      const outcome = await reloadForAppUpdate({
        waitForExport,
        signal: controller.signal,
        onProgress: message => update({ kind: 'busy', message }),
      });
      // The page normally unloads now; if the person stays (cancelled leave warning), the brand works again.
      if (outcome.status === 'reloading') stillHereTimerRef.current = setTimeout(() => update({ kind: 'idle' }), STILL_HERE_AFTER_RELOAD_MS);
      else if (outcome.status === 'export-running') update({ kind: 'ask-export' });
      else if (outcome.status === 'save-failed') update({ kind: 'failed', message: outcome.message });
      else if (outcome.status === 'cancelled') update({ kind: 'idle' });
    } catch (error) {
      update({ kind: 'failed', message: `The update could not start: ${error instanceof Error ? error.message : String(error)}` });
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  return {
    phase,
    start: useCallback(() => { void run(false); }, [run]),
    updateAfterExport: useCallback(() => { void run(true); }, [run]),
    dismiss: useCallback(() => {
      controllerRef.current?.abort();
      controllerRef.current = null;
      setPhase({ kind: 'idle' });
    }, []),
  };
}
