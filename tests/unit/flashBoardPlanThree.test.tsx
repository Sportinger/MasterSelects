import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardActionStack } from '../../src/components/panels/flashboard/FlashBoardActionStack';
import {
  buildFlashBoardChatOptimisticMessages,
  buildFlashBoardChatSendPlan,
  normalizeFlashBoardSubmittedPrompt,
} from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';

function buildSendPlan(planThreeEnabled: boolean) {
  return buildFlashBoardChatSendPlan({
    activeChatModelId: 'gpt-5-6-terra',
    canUseHostedChat: true,
    chatMessages: [],
    chatPanelOpen: true,
    chatProvider: 'kie',
    chatTemperature: 0.7,
    effectiveChatPrompt: 'Cut a short travel montage.',
    hasHostedSession: true,
    hostedAIEnabled: true,
    isChatting: false,
    openAiReasoningEffort: 'medium',
    planThreeEnabled,
  });
}

describe('FlashBoard Plan 3 mode', () => {
  it('collapses an exact adjacent duplicate at the chat submission boundary', () => {
    expect(normalizeFlashBoardSubmittedPrompt(
      'ok ,dann jetzt 200%- 140%ok ,dann jetzt 200%- 140%',
    )).toBe('ok ,dann jetzt 200%- 140%');
    expect(normalizeFlashBoardSubmittedPrompt('go go')).toBe('go go');
    expect(normalizeFlashBoardSubmittedPrompt('Repeat this sentence. Repeat this sentence.'))
      .toBe('Repeat this sentence. Repeat this sentence.');
  });

  it('keeps a normal chat request unchanged while the toggle is off', () => {
    const plan = buildSendPlan(false);

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.prompt).toBe('Cut a short travel montage.');
    expect(plan.request.playbookPrompt).toBe('Cut a short travel montage.');
  });

  it('instructs every AI path to build three separate composition versions', () => {
    const plan = buildSendPlan(true);

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.prompt).toContain('[PLAN 3 MODE]');
    expect(plan.request.prompt).toContain('exactly three separate, new, user-visible compositions');
    expect(plan.request.prompt).toContain('Version 1 — Balanced');
    expect(plan.request.prompt).toContain('Version 2 — Dynamic');
    expect(plan.request.prompt).toContain('Version 3 — Alternative');
    expect(plan.request.prompt).toContain('Original request:\nCut a short travel montage.');
    expect(plan.request.playbookPrompt).toBe(plan.request.prompt);
  });

  it('keeps the original user wording in the visible chat history', () => {
    const messages = buildFlashBoardChatOptimisticMessages({
      assistantMessageId: 'assistant-1',
      userMessageId: 'user-1',
      userPrompt: 'Cut a short travel montage.',
    });

    expect(messages[0]?.text).toBe('Cut a short travel montage.');
    expect(messages[0]?.text).not.toContain('PLAN 3');
  });

  it('keeps the dormant Plan 3 mode out of the chat action UI', () => {
    const props = {
      canGenerate: true,
      chatButtonLabel: 'Chat',
      chatButtonTitle: 'Send chat prompt',
      chatPanelOpen: true,
      generateButtonLabel: 'Generate',
      generateButtonTitle: 'Generate media',
      isChatting: false,
      onChatButtonClick: vi.fn(),
      onGenerate: vi.fn(),
    };
    render(<FlashBoardActionStack {...props} />);

    expect(screen.queryByRole('button', { name: 'Plan 3' })).not.toBeInTheDocument();
  });
});
