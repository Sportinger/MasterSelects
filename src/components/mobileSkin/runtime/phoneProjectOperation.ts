// The project operation the phone is running right now (create, open, reopen, import, folder open)
// and how its progress reads in plain words. PhoneProjectLoadingView covers the screen while one runs.
// Plain data only: a name, a kind and a start time.
import { create } from 'zustand';
import type { ProjectLoadProgress } from '../../../stores/mediaStore';

export type PhoneProjectOperationKind = 'create' | 'open' | 'resume' | 'import' | 'folder' | 'restore';

export interface PhoneProjectOperation {
  kind: PhoneProjectOperationKind;
  /** Project name as the person typed or picked it; empty when not known yet (folder pick, restore). */
  name: string;
  startedAt: number;
}

interface PhoneProjectOperationState {
  operation: PhoneProjectOperation | null;
}

export const usePhoneProjectOperationStore = create<PhoneProjectOperationState>(() => ({ operation: null }));

/** Covers the screen with the loading view while `action` runs; always ends it, also on a throw. */
export async function runPhoneProjectOperation<T>(
  kind: PhoneProjectOperationKind,
  name: string,
  action: () => Promise<T>,
  now: () => number = Date.now,
): Promise<T> {
  const operation: PhoneProjectOperation = { kind, name, startedAt: now() };
  usePhoneProjectOperationStore.setState({ operation });
  try {
    return await action();
  } finally {
    // A newer operation started meanwhile keeps its own view.
    if (usePhoneProjectOperationStore.getState().operation === operation) {
      usePhoneProjectOperationStore.setState({ operation: null });
    }
  }
}

export type PhoneLoadStep = 'waiting' | 'opening' | 'creating' | 'reading' | 'preparing';

export const PHONE_LOAD_STEP_LABELS: Record<PhoneLoadStep, string> = {
  waiting: 'Waiting for folder access',
  opening: 'Opening',
  creating: 'Creating',
  reading: 'Reading project',
  preparing: 'Preparing editor',
};

/**
 * Maps the editor's load progress to one of a few plain steps. A reopen starts at "Waiting for
 * folder access": the browser prompt comes first, and the editor's background scratch open (which
 * shares the progress) can report its own "Opening" meanwhile.
 */
export function phoneLoadStep(kind: PhoneProjectOperationKind | null, progress: ProjectLoadProgress): PhoneLoadStep {
  const first: PhoneLoadStep = kind === 'create' ? 'creating' : kind === 'resume' ? 'waiting' : 'opening';
  if (!progress.active) return first;
  const message = progress.message.toLowerCase();
  if (message.includes('folder access')) return 'waiting';
  if (progress.phase === 'timeline' || progress.phase === 'ui' || progress.phase === 'relink'
    || progress.phase === 'ready' || message.includes('restoring editor') || message.includes('workspace')) return 'preparing';
  if (progress.phase === 'media' || message.includes('reading') || message.includes('history')
    || message.includes('importing') || message.includes('android')) return 'reading';
  return first;
}

export const PHONE_LOAD_ELAPSED_AFTER_MS = 5_000;

/** '7 s' or '1 min 04 s' once the operation runs longer than 5 s, else null. */
export function formatPhoneLoadElapsed(ms: number): string | null {
  if (!Number.isFinite(ms) || ms < PHONE_LOAD_ELAPSED_AFTER_MS) return null;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
}

/** Title line of the loading view. */
export function phoneLoadTitle(operation: PhoneProjectOperation | null): string {
  const name = operation?.name.trim();
  switch (operation?.kind) {
    case 'create': return name ? `Creating “${name}”` : 'Creating your project';
    case 'resume': return name ? `Reopening “${name}”` : 'Reopening your project';
    case 'import': return name ? `Importing “${name}”` : 'Importing the project';
    case 'folder': return 'Opening the project folder';
    case 'open': return name ? `Opening “${name}”` : 'Opening your project';
    default: return 'Opening your last project';
  }
}
