import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardActionStack } from '../../src/components/panels/flashboard/FlashBoardActionStack';
import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';

describe('Storyboard directing controls', () => {
  it('renders an accessible Plan chip and decision-policy control', () => {
    const onChatIntentToggle = vi.fn();
    const onDecisionPolicyChange = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Send"
      chatButtonTitle="Send prompt"
      chatIntent="plan"
      chatPanelOpen
      decisionPolicy="milestones"
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={vi.fn()}
      onChatIntentToggle={onChatIntentToggle}
      onDecisionPolicyChange={onDecisionPolicyChange}
      onGenerate={vi.fn()}
      onPlanThreeToggle={vi.fn()}
      planThreeEnabled={false}
    />);

    const plan = screen.getByRole('button', { name: 'Plan' });
    expect(plan).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(plan);
    expect(onChatIntentToggle).toHaveBeenCalledTimes(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Decision policy' }), {
      target: { value: 'every-decision' },
    });
    expect(onDecisionPolicyChange).toHaveBeenCalledWith('every-decision');
  });

  it('builds a Plan request that is enforced by the shared tool boundary', () => {
    const plan = buildFlashBoardChatSendPlan({
      activeChatModelId: 'gpt-5-6-luna',
      canUseByoChat: true,
      canUseHostedChat: false,
      chatIntent: 'plan',
      chatMessages: [],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0.7,
      decisionPolicy: 'milestones',
      effectiveChatPrompt: 'Draft three scenes.',
      hasHostedSession: false,
      hostedAIEnabled: false,
      isChatting: false,
      kieAiApiKey: 'test-key',
      lemonadeContextSize: 8_192,
      lemonadeEndpoint: 'http://localhost:13305/api/v1',
      openAiReasoningEffort: 'medium',
      planThreeEnabled: false,
      shouldUseHostedChat: false,
      useHostedProductionProviders: false,
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
      canUseByoChat: true,
      canUseHostedChat: false,
      chatIntent: 'plan',
      chatMessages: [],
      chatPanelOpen: true,
      chatProvider: 'kie',
      chatTemperature: 0.7,
      decisionPolicy: 'milestones',
      effectiveChatPrompt: 'Improve the marked range.',
      hasHostedSession: false,
      hostedAIEnabled: false,
      isChatting: false,
      kieAiApiKey: 'test-key',
      lemonadeContextSize: 8_192,
      lemonadeEndpoint: 'http://localhost:13305/api/v1',
      openAiReasoningEffort: 'medium',
      planThreeEnabled: true,
      shouldUseHostedChat: false,
      useHostedProductionProviders: false,
    });

    expect(plan.action).toBe('send');
    if (plan.action !== 'send') return;
    expect(plan.request.prompt).toContain('three separate storyboard or range-variant options');
    expect(plan.request.prompt).toContain('without materializing real compositions');
    expect(plan.request.prompt).not.toContain('Fully build and verify all three');
  });
});
