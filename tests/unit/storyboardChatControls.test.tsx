import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardActionStack } from '../../src/components/panels/flashboard/FlashBoardActionStack';
import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';

describe('Storyboard directing controls', () => {
  it('defaults the decision policy selector to Auto', () => {
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Send"
      chatButtonTitle="Send prompt"
      chatPanelOpen
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={vi.fn()}
      onGenerate={vi.fn()}
    />);

    expect(screen.getByRole('combobox', { name: 'Decision policy' })).toHaveValue('automatic');
  });

  it('keeps Plan controls hidden while retaining the decision policy selector', () => {
    const onDecisionPolicyChange = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Send"
      chatButtonTitle="Send prompt"
      chatPanelOpen
      decisionPolicy="milestones"
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={vi.fn()}
      onDecisionPolicyChange={onDecisionPolicyChange}
      onGenerate={vi.fn()}
    />);

    expect(screen.queryByRole('button', { name: 'Plan' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Execute' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Plan 3' })).not.toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Decision policy' }), {
      target: { value: 'every-decision' },
    });
    expect(onDecisionPolicyChange).toHaveBeenCalledWith('every-decision');
  });

  it('builds a Plan request that is enforced by the shared tool boundary', () => {
    const plan = buildFlashBoardChatSendPlan({
      activeChatModelId: 'gpt-5-6-luna',
      canUseHostedChat: true,
      chatIntent: 'plan',
      chatMessages: [],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0.7,
      decisionPolicy: 'milestones',
      effectiveChatPrompt: 'Draft three scenes.',
      hasHostedSession: true,
      hostedAIEnabled: true,
      isChatting: false,
      openAiReasoningEffort: 'medium',
      planThreeEnabled: false,
    });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request).toMatchObject({
      intent: 'plan',
      decisionPolicy: 'milestones',
      toolExecutionMode: 'plan',
    });
    expect(plan.request.prompt).toContain('[DIRECTING MODE: PLAN]');
  });

  it('turns Plan 3 into non-materialized storyboard options while Plan mode is active', () => {
    const plan = buildFlashBoardChatSendPlan({
      activeChatModelId: 'gpt-5-6-luna',
      canUseHostedChat: true,
      chatIntent: 'plan',
      chatMessages: [],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0.7,
      decisionPolicy: 'milestones',
      effectiveChatPrompt: 'Improve the marked range.',
      hasHostedSession: true,
      hostedAIEnabled: true,
      isChatting: false,
      openAiReasoningEffort: 'medium',
      planThreeEnabled: true,
    });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.prompt).toContain('three separate storyboard or range-variant options');
    expect(plan.request.prompt).toContain('without materializing real compositions');
    expect(plan.request.prompt).not.toContain('Fully build and verify all three');
  });
});
