import { describe, expect, it } from 'vitest';
import {
  buildFlashBoardChatApplyOptionPrompt,
  buildFlashBoardChatEditOptionsPrompt,
  parseFlashBoardChatEditOptions,
  type FlashBoardChatEditOption,
} from '../../src/components/panels/flashboard/FlashBoardChatEditOptions';

describe('FlashBoard chat edit options', () => {
  it('wraps a user prompt as text-only options planning without tool execution', () => {
    const prompt = buildFlashBoardChatEditOptionsPrompt('Make a fast trailer');

    expect(prompt).toContain('Make a fast trailer');
    expect(prompt).toContain('Do not call tools');
    expect(prompt).toContain('OPTION 1:');
    expect(prompt).toContain('OPTION 3:');
  });

  it('parses at least two structured options from a model response', () => {
    const options = parseFlashBoardChatEditOptions([
      'OPTION 1: Fast trailer',
      'Cut to high-motion shots with punchy pacing.',
      '',
      'OPTION 2: Calm story',
      'Use longer clips and smoother transitions.',
      '',
      'OPTION 3: Social teaser',
      'Open with the strongest hook and keep it short.',
    ].join('\n'));

    expect(options).toEqual([
      { index: 1, title: 'Fast trailer', description: 'Cut to high-motion shots with punchy pacing.' },
      { index: 2, title: 'Calm story', description: 'Use longer clips and smoother transitions.' },
      { index: 3, title: 'Social teaser', description: 'Open with the strongest hook and keep it short.' },
    ]);
  });

  it('builds an apply prompt for the selected option', () => {
    const option: FlashBoardChatEditOption = {
      index: 2,
      title: 'Calm story',
      description: 'Use longer clips and smoother transitions.',
    };

    expect(buildFlashBoardChatApplyOptionPrompt(option)).toContain('Apply option 2: Calm story');
    expect(buildFlashBoardChatApplyOptionPrompt(option)).toContain('Execute the required MasterSelects tools now');
  });
});
