import { describe, expect, it } from 'vitest';

import {
  buildFlashBoardChatModelFallback,
  buildFlashBoardChatModelOptions,
  buildFlashBoardChatProviderFallback,
} from '../../src/components/panels/flashboard/FlashBoardChatOptionsPlanner';
import {
  DEFAULT_FLASHBOARD_CHAT_MODEL,
  DEFAULT_FLASHBOARD_CHAT_PROVIDER,
  DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT,
  FLASHBOARD_CHAT_PROVIDERS,
  FLASHBOARD_CHAT_MODEL_OPTIONS,
  FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS,
} from '../../src/services/flashboard/FlashBoardChatService';

describe('FlashBoard chat options planner', () => {
  it('offers only hosted AI with AI as the default', () => {
    expect(FLASHBOARD_CHAT_PROVIDERS).toEqual([
      { id: 'kie', label: 'AI' },
    ]);
    expect(DEFAULT_FLASHBOARD_CHAT_PROVIDER).toBe('kie');
    expect(DEFAULT_FLASHBOARD_CHAT_MODEL).toBe('gpt-5-6-terra');
    expect(DEFAULT_FLASHBOARD_OPENAI_REASONING_EFFORT).toBe('medium');
    expect(FLASHBOARD_CHAT_MODEL_OPTIONS.kie[0]?.id).toBe(DEFAULT_FLASHBOARD_CHAT_MODEL);
    expect(FLASHBOARD_CHAT_MODEL_OPTIONS.kie[0]?.reasoningEfforts).not.toContain('none');
    expect(FLASHBOARD_OPENAI_REASONING_EFFORT_OPTIONS[0]).toEqual({
      id: 'none',
      label: 'None',
    });
    expect(buildFlashBoardChatModelOptions({ chatProvider: 'kie' }))
      .toBe(FLASHBOARD_CHAT_MODEL_OPTIONS.kie);
    expect(buildFlashBoardChatProviderFallback({
      chatProvider: 'kie',
      chatProviderOptions: FLASHBOARD_CHAT_PROVIDERS,
    })).toBeUndefined();
  });

  it('falls back from a stale hosted model to the current default', () => {
    const options = buildFlashBoardChatModelOptions({
      chatProvider: 'kie',
    });

    expect(options.map((option) => option.id)).toContain(DEFAULT_FLASHBOARD_CHAT_MODEL);
    expect(buildFlashBoardChatModelFallback({
      chatModel: 'retired-model',
      chatModelOptions: options,
    })).toBe(DEFAULT_FLASHBOARD_CHAT_MODEL);
  });
});
