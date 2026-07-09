import { describe, expect, it } from 'vitest';

import {
  buildFlashBoardChatModelFallback,
  buildFlashBoardChatModelOptions,
} from '../../src/components/panels/flashboard/FlashBoardChatOptionsPlanner';

describe('FlashBoard chat options planner', () => {
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
