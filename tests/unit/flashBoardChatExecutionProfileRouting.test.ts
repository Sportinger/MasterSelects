import { describe, expect, it } from 'vitest';

import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import type {
  FlashBoardChatExecutionProfile,
  FlashBoardChatModelClass,
  FlashBoardChatProvider,
} from '../../src/services/flashboard/FlashBoardChatService';

function planFor(
  provider: FlashBoardChatProvider,
  input: {
    canUseHostedChat: boolean;
    executionProfile?: FlashBoardChatExecutionProfile;
    modelClass?: FlashBoardChatModelClass;
  },
) {
  return buildFlashBoardChatSendPlan({
    activeChatModelId: provider === 'kernel' ? 'masterselects-ai' : 'gpt-5-6-terra',
    canUseHostedChat: input.canUseHostedChat,
    chatExecutionProfile: input.executionProfile,
    chatModelClass: input.modelClass,
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
  it('defaults an eligible hosted Kie request to Fast without a model class', () => {
    const plan = planFor('kie', { canUseHostedChat: true });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.executionProfile).toBe('fast');
    // Without a confirmed availability probe no class is forwarded; the Fast
    // V2 transport applies the server-side 'fast' default, and a K2-selected
    // account never sees the field.
    expect(plan.request).not.toHaveProperty('requestedModelClass');
  });

  it('writes only the selected server-owned model class to hosted requests', () => {
    const hosted = planFor('kie', {
      canUseHostedChat: true,
      modelClass: 'very-fast',
    });
    const kernel = planFor('kernel', {
      canUseHostedChat: false,
      modelClass: 'slow',
    });

    expect(hosted.action).toBe('send');
    expect(kernel.action).toBe('send');
    if (hosted.action !== 'send' || kernel.action !== 'send') return;
    expect(hosted.request.requestedModelClass).toBe('very-fast');
    expect(kernel.request).not.toHaveProperty('requestedModelClass');
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
