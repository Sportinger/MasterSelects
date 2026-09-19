import { describe, expect, it } from 'vitest';
import { buildWhisperTaskOptions } from '../../src/services/transcription/whisperTaskOptions';

describe('Whisper task options', () => {
  it('auto-detects the language while explicitly preserving it in the transcript', () => {
    expect(buildWhisperTaskOptions('auto')).toEqual({ task: 'transcribe' });
  });

  it('keeps explicit multilingual transcription in the requested language', () => {
    expect(buildWhisperTaskOptions('de')).toEqual({ language: 'de', task: 'transcribe' });
  });
});
