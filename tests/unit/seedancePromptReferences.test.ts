import { describe, expect, it } from 'vitest';

import {
  buildSeedancePromptReferences,
  getSeedancePromptReferenceToken,
  getSeedancePromptReferenceTokens,
  insertSeedancePromptReferenceTokens,
  remapSeedancePromptReferenceTokens,
} from '../../src/components/panels/flashboard/SeedancePromptReferences';

const mediaTypes = new Map([
  ['image-a', 'image'],
  ['image-b', 'image'],
  ['video-a', 'video'],
  ['audio-a', 'audio'],
]);

function references(ids: string[]) {
  return buildSeedancePromptReferences(ids, (id) => mediaTypes.get(id));
}

describe('Seedance prompt references', () => {
  it('numbers image, video, and audio arrays independently', () => {
    const refs = references(['image-a', 'video-a', 'image-b', 'audio-a']);

    expect(getSeedancePromptReferenceTokens(refs)).toEqual([
      '@Image1',
      '@Video1',
      '@Image2',
      '@Audio1',
    ]);
    expect(getSeedancePromptReferenceToken(refs, 'image-b')).toBe('@Image2');
  });

  it('inserts dropped reference tokens at the prompt selection', () => {
    expect(insertSeedancePromptReferenceTokens(
      'Use for the hero.',
      ['@Image1', '@Video1'],
      4,
      4,
    )).toEqual({
      caret: 19,
      prompt: 'Use @Image1 @Video1 for the hero.',
    });
  });

  it('keeps tokens attached to media when an earlier reference is removed', () => {
    expect(remapSeedancePromptReferenceTokens(
      'Use @Image2 for the hero and @Image1 for the background.',
      references(['image-a', 'image-b']),
      references(['image-b']),
    )).toBe('Use @Image1 for the hero and for the background.');
  });

  it('keeps tokens attached to media when reference images are reordered', () => {
    expect(remapSeedancePromptReferenceTokens(
      'Keep @Image1 in the background and @Image2 as the hero.',
      references(['image-a', 'image-b']),
      references(['image-b', 'image-a']),
    )).toBe('Keep @Image2 in the background and @Image1 as the hero.');
  });

  it('leaves manually typed unknown tokens untouched', () => {
    expect(remapSeedancePromptReferenceTokens(
      'Use @Image9 as a future reference.',
      references(['image-a']),
      references([]),
    )).toBe('Use @Image9 as a future reference.');
  });
});
