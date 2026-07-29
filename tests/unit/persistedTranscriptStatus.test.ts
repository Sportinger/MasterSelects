import { describe, expect, it } from 'vitest';
import { recoverPersistedTranscriptStatus } from '../../src/services/transcription/persistedTranscriptStatus';

describe('recoverPersistedTranscriptStatus', () => {
  it('turns a reloaded run with checkpoint words into a resumable partial transcript', () => {
    expect(recoverPersistedTranscriptStatus('transcribing', [{
      confidence: 0.9,
      end: 1,
      id: 'word-1',
      start: 0,
      text: 'hello',
    }])).toBe('ready');
  });

  it('clears an orphaned busy state when no chunk completed', () => {
    expect(recoverPersistedTranscriptStatus('transcribing', [])).toBe('none');
  });

  it('preserves terminal statuses', () => {
    expect(recoverPersistedTranscriptStatus('error', [])).toBe('error');
    expect(recoverPersistedTranscriptStatus('ready', [])).toBe('ready');
  });
});
