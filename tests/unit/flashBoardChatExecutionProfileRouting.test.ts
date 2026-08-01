import { describe, expect, it } from 'vitest';

import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import type {
  FlashBoardChatExecutionProfile,
  FlashBoardChatProvider,
} from '../../src/services/flashboard/FlashBoardChatService';

function planFor(
  provider: FlashBoardChatProvider,
  input: {
    canUseHostedChat: boolean;
    executionProfile?: FlashBoardChatExecutionProfile;
  },
) {
  return buildFlashBoardChatSendPlan({
    activeChatModelId: provider === 'kernel' ? 'masterselects-ai' : 'gpt-5-6-terra',
    canUseHostedChat: input.canUseHostedChat,
    chatExecutionProfile: input.executionProfile,
    chatMessages: [],
    chatPanelOpen: true,
    chatProvider: provider,
    chatTemperature: 0.7,
    effectiveChatPrompt: 'Inspect the marked range.',
    hasHostedSession: true,
    hostedAIEnabled: true,
    isChatting: false,
    openAiReasoningEffort: 'medium',
    planThreeEnabled: false,
  });
}

describe('FlashBoard hosted execution-profile request routing', () => {
  it('defaults an eligible hosted Kie request to Fast', () => {
    const plan = planFor('kie', { canUseHostedChat: true });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.executionProfile).toBe('fast');
  });

  it('writes an explicit Verified profile only to an eligible hosted Kie request', () => {
    const hosted = planFor('kie', {
      canUseHostedChat: true,
      executionProfile: 'verified',
    });
    const kernel = planFor('kernel', {
      canUseHostedChat: false,
      executionProfile: 'verified',
    });

    expect(hosted.action).toBe('send');
    expect(kernel.action).toBe('send');
    if (hosted.action !== 'send' || kernel.action !== 'send') return;
    expect(hosted.request.executionProfile).toBe('verified');
    expect(kernel.request).not.toHaveProperty('executionProfile');
  });
});
