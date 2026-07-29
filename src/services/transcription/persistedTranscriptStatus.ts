import type { TranscriptStatus, TranscriptWord } from '../../types/clipMetadata';

/**
 * A page reload cannot retain the browser-owned request. Completed chunks are
 * persisted separately, so a serialized in-flight status must become a usable
 * partial result instead of leaving the UI permanently busy.
 */
export function recoverPersistedTranscriptStatus(
  status: TranscriptStatus | undefined,
  words: readonly TranscriptWord[] | undefined,
): TranscriptStatus {
  if (status !== 'transcribing') return status ?? 'none';
  return words?.length ? 'ready' : 'none';
}
