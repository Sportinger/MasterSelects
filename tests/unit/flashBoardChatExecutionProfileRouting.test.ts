import { describe, expect, it } from 'vitest';

import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import type {
  FlashBoardChatAgentMode,
  FlashBoardChatModelClass,
} from '../../src/services/flashboard/FlashBoardChatService';

function planFor(input: {
  agentMode?: FlashBoardChatAgentMode;
  decisionPolicy?: 'automatic' | 'milestones';
  modelClass?: FlashBoardChatModelClass;
} = {}) {
  return buildFlashBoardChatSendPlan({
    activeChatModelId: 'gpt-5-6-terra',
    canUseHostedChat: true,
    chatAgentMode: input.agentMode,
    chatExecutionProfile: 'fast',
    chatModelClass: input.modelClass,
    chatMessages: [],
    chatPanelOpen: true,
    chatProvider: 'kie',
    chatTemperature: 0.7,
    decisionPolicy: input.decisionPolicy,
    effectiveChatPrompt: 'Inspect the marked range.',
    hasHostedSession: true,
    hostedAIEnabled: true,
    isChatting: false,
    openAiReasoningEffort: 'medium',
    planThreeEnabled: false,
  });
}

describe('Normal Path chat request routing', () => {
  it('always uses the single internal execution profile', () => {
    const plan = planFor();

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.executionProfile).toBe('fast');
  });

  it('forwards only the selected server-owned speed class', () => {
    const plan = planFor({ modelClass: 'very-fast' });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.requestedModelClass).toBe('very-fast');
    expect(plan.request).not.toHaveProperty('providerId');
  });

  it('routes Codex Direct outside the Normal Path and never requests Logic', () => {
    const direct = planFor({ agentMode: 'direct' });
    const staleLogic = planFor({ agentMode: 'logic' });
    const standard = planFor({ agentMode: 'standard' });

    expect(direct.action).toBe('send');
    expect(staleLogic.action).toBe('send');
    expect(standard.action).toBe('send');
    if (direct.action !== 'send' || staleLogic.action !== 'send' || standard.action !== 'send') return;
    expect(direct.request.agentPath).toBe('direct-codex');
    expect(direct.request).not.toHaveProperty('requestedAgentMode');
    expect(staleLogic.request).not.toHaveProperty('requestedAgentMode');
    expect(standard.request).not.toHaveProperty('requestedAgentMode');
  });

  it('routes Guided to the DeepSeek class regardless of hidden speed state', () => {
    const guided = planFor({
      agentMode: 'logic',
      decisionPolicy: 'milestones',
      modelClass: 'slow',
    });

    expect(guided.action).toBe('send');
    if (guided.action !== 'send') return;
    expect(guided.request.requestedModelClass).toBe('very-fast');
    expect(guided.request).not.toHaveProperty('requestedAgentMode');
  });
});
