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
  it('offers AI and Local AI with AI as the default', () => {
    expect(FLASHBOARD_CHAT_PROVIDERS).toEqual([
      { id: 'kie', label: 'AI' },
      { id: 'lemonade', label: 'Local AI' },
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
    expect(buildFlashBoardChatModelOptions({
      chatModel: 'masterselects-ai',
      chatProvider: 'kernel',
      lemonadeModels: [],
    })).toEqual([
      expect.objectContaining({
        id: 'masterselects-ai',
        provider: 'kernel',
      }),
    ]);
    expect(buildFlashBoardChatProviderFallback({
      chatProvider: 'kernel',
      chatProviderOptions: FLASHBOARD_CHAT_PROVIDERS,
    })).toBe('kie');
  });

  it('falls back from the stale Lemonade default when discovered models are available', () => {
    const options = buildFlashBoardChatModelOptions({
      chatModel: 'gemma4-it-e2b-FLM',
      chatProvider: 'lemonade',
      lemonadeModels: [
        { id: 'AMD-OLMo-1B-SFT-DPO-Hybrid' },
        { id: 'Bonsai-1.7B-gguf' },
      ],
    });

    expect(options.map((option) => option.id)).toEqual([
      'AMD-OLMo-1B-SFT-DPO-Hybrid',
      'Bonsai-1.7B-gguf',
    ]);
    expect(buildFlashBoardChatModelFallback({
      chatModel: 'gemma4-it-e2b-FLM',
      chatModelOptions: options,
    })).toBe('AMD-OLMo-1B-SFT-DPO-Hybrid');
  });
});
