// Pure rules of the Voiceover tab's rescue list (tested in phoneAudioRegions.test.ts).

import type { AudioRecordingRecoveryEntry, AudioRecordingState } from '../../../types/audio';

/** Entries a person can rescue now: not the recording that is running at this moment. */
export function rescuablePhoneRecoveryEntries(snapshot: AudioRecordingState, entries: readonly AudioRecordingRecoveryEntry[]): AudioRecordingRecoveryEntry[] {
  return entries.filter((entry) => !(entry.status === 'active' && entry.sessionId === snapshot.sessionId));
}
