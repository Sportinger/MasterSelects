// Rescuing a kept recording from the Audio sheet. The editor's AudioRecordingService consumes the
// rescue entry and deletes its stored audio as soon as the take is on the timeline, outside any
// transaction. A rescue inside the sheet's cancellable edit session could therefore be rolled back
// by Cancel, the backdrop or a window blur while the take itself is already gone for good. So a
// rescue is always its own committed undo step ("Rescue recording"), and it is refused while the
// sheet holds uncommitted changes: rolling those back would restore the timeline from before the
// rescue and remove the rescued clip again.

import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { getEditorRepositorySession, runEditorBatch } from '../../../services/project/repository/transaction/editorMutationRuntime';
import { endBatch, startBatch } from '../../../stores/historyStore';
import type { PhoneEditSession } from '../sheets/phoneEditSession';

export const PHONE_RESCUE_LABEL = 'Rescue recording';

export type PhoneRescueOutcome =
  | { kind: 'rescued'; clips: number }
  | { kind: 'already-added' }
  | { kind: 'needs-done' }
  | { kind: 'failed'; message: string };

export interface PhoneRescueDeps {
  commit: (sessionId: string) => Promise<{ clips: readonly unknown[] }>;
  repository: () => boolean;
  runBatch: <T>(label: string, action: () => Promise<T>) => Promise<T>;
  startLegacyBatch: (label: string) => { opened: boolean };
  endLegacyBatch: () => void;
}

const defaultDeps: PhoneRescueDeps = {
  commit: (sessionId) => audioRecordingService.commitRecoveryEntry(sessionId),
  repository: () => getEditorRepositorySession() !== null,
  runBatch: runEditorBatch,
  startLegacyBatch: (label) => startBatch(label),
  endLegacyBatch: endBatch,
};

export async function rescuePhoneRecording(
  session: Pick<PhoneEditSession, 'changed' | 'closed'>,
  recordingSessionId: string,
  overrides: Partial<PhoneRescueDeps> = {},
): Promise<PhoneRescueOutcome> {
  const deps = { ...defaultDeps, ...overrides };
  if (session.changed && !session.closed) return { kind: 'needs-done' };
  try {
    let clips = 0;
    const run = async () => { clips = (await deps.commit(recordingSessionId)).clips.length; };
    if (deps.repository()) {
      await deps.runBatch(PHONE_RESCUE_LABEL, run);
    } else {
      const batch = deps.startLegacyBatch(PHONE_RESCUE_LABEL);
      try { await run(); } finally { if (batch.opened) deps.endLegacyBatch(); }
    }
    return clips === 0 ? { kind: 'already-added' } : { kind: 'rescued', clips };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
