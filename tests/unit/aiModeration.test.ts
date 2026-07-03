import { describe, expect, it } from 'vitest';
import { blocksAiRequest, buildModerationInput, type AiModerationResult } from '../../functions/lib/aiModeration';

function moderation(status: AiModerationResult['status'], flagged = false): AiModerationResult {
  return {
    categories: flagged ? ['illicit'] : [],
    errorMessage: null,
    flagged,
    payload: null,
    status,
  };
}

describe('hosted AI moderation helpers', () => {
  it('extracts prompt text from nested request payloads', () => {
    expect(buildModerationInput({
      prompt: 'make a clip',
      referenceMedia: [{ label: 'REF 1', source: 'https://example.test/a.png' }],
    })).toBe('make a clip');

    expect(buildModerationInput([{ text: 'first' }, { prompt: 'second' }])).toBe('first\nsecond');
  });

  it('blocks flagged and failed moderation results', () => {
    expect(blocksAiRequest(moderation('clean'))).toBe(false);
    expect(blocksAiRequest(moderation('flagged', true))).toBe(true);
    expect(blocksAiRequest(moderation('error'))).toBe(true);
  });
});
