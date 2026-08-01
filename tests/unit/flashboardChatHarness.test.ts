import { describe, expect, it } from 'vitest';

import { buildFlashBoardChatRequestPrompt } from '../../src/services/flashboard/FlashBoardChatHistory';
import {
  buildFlashBoardChatSystemPrompt,
  FLASHBOARD_CHAT_SYSTEM_PROMPT,
} from '../../src/services/flashboard/FlashBoardChatService';
import { selectFlashBoardChatPlaybooks } from '../../src/services/flashboard/FlashBoardChatPlaybooks';

describe('FlashBoard chat v2 prompt harness', () => {
  it('uses a compact inspect-plan-act-verify-report default', () => {
    const prompt = buildFlashBoardChatSystemPrompt({ includeContext: false });

    expect(prompt).toBe(FLASHBOARD_CHAT_SYSTEM_PROMPT);
    expect(prompt).toContain('OPERATING LOOP');
    for (const step of ['Inspect:', 'Plan:', 'Act:', 'Verify:', 'Report:']) {
      expect(prompt).toContain(step);
    }
    expect(prompt.length).toBeGreaterThan(1_000);
    expect(prompt.length).toBeLessThan(3_500);
  });

  it('independently controls live context without accepting prompt overrides', () => {
    const withContext = buildFlashBoardChatSystemPrompt();
    const withoutContext = buildFlashBoardChatSystemPrompt({
      includeContext: false,
      userPrompt: 'Use the transcript.',
    });

    expect(withContext).toContain('Current MasterSelects context:');
    expect(withoutContext).toContain(FLASHBOARD_CHAT_SYSTEM_PROMPT);
    expect(withoutContext).not.toContain('Current MasterSelects context:');
  });

  it('describes attached references as already available to the model', () => {
    const prompt = buildFlashBoardChatSystemPrompt({
      visualReferences: [{
        dataUrl: 'data:image/png;base64,AAAA',
        id: 'reference-1',
        mediaType: 'image/png',
        name: 'Reference.png',
        width: 464,
        height: 649,
      }],
    });

    expect(prompt).toContain('Reference.png [id=reference-1, image/png, 464x649]');
    expect(prompt).toContain('do not call getMediaItems');
  });

  it('injects only task-relevant playbooks for v2', () => {
    const montage = buildFlashBoardChatSystemPrompt({
      includeContext: false,
      userPrompt: 'Build a random montage from 30 short clips using transcript dialogue and verify it visually.',
    });
    const unrelated = buildFlashBoardChatSystemPrompt({
      includeContext: false,
      userPrompt: 'Move the playhead to ten seconds.',
    });

    expect(montage).toContain('TASK-SPECIFIC PLAYBOOK');
    expect(montage).toContain('MONTAGE / MANY CUTS');
    expect(montage).toContain('TRANSCRIPT');
    expect(montage).toContain('VISUAL VERIFICATION');
    expect(unrelated).not.toContain('TASK-SPECIFIC PLAYBOOK');
  });

  it('selects transcript and face guidance without injecting every recipe', () => {
    expect(selectFlashBoardChatPlaybooks('Use the transcript to keep only Person 2 speaking'))
      .toEqual(expect.arrayContaining(['transcript', 'face']));
    expect(selectFlashBoardChatPlaybooks('please cut out all parts where no one speaks'))
      .toEqual(expect.arrayContaining(['transcript', 'silence']));
    expect(selectFlashBoardChatPlaybooks('Schneide alle Stellen, wo niemand spricht, heraus'))
      .toEqual(expect.arrayContaining(['transcript', 'silence']));
    expect(selectFlashBoardChatPlaybooks('Create a three-scene storyboard in Plan mode'))
      .toEqual(expect.arrayContaining(['storyboard', 'visual']));
    expect(selectFlashBoardChatPlaybooks('Set opacity to 50 percent')).toEqual([]);
  });

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
