import { describe, expect, it } from 'vitest';
import { buildFlashBoardChatRequestPrompt } from '../../src/services/flashboard/FlashBoardChatHistory';

describe('FlashBoard bounded request history', () => {
  it('carries successful tool history into follow-up turns within a bounded context', () => {
    const prompt = buildFlashBoardChatRequestPrompt([
      { id: 'user-1', role: 'user', text: 'Inspect the selected clip.' },
      {
        id: 'assistant-1',
        role: 'assistant',
        text: 'The clip is ready.',
        toolCalls: [{
          modelContent: '{"success":true,"data":{"duration":12}}',
          result: { success: true, data: { duration: 12 } },
          toolCall: { id: 'call-1', name: 'getClipDetails', arguments: '{"clipId":"clip-1"}' },
        }],
      },
    ], 'Now trim the first second.');

    expect(prompt).toContain('Executed tools:');
    expect(prompt).toContain('getClipDetails');
    expect(prompt).toContain('"duration":12');
    expect(prompt).toContain('User: Now trim the first second.');
  });
});
