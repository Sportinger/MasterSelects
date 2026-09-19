import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlashBoardActionStack } from '../../src/components/panels/flashboard/FlashBoardActionStack';
import { buildFlashBoardChatSendPlan } from '../../src/components/panels/flashboard/FlashBoardChatSendPlanner';
import { setFlashBoardGuidedMode } from '../../src/services/flashboard/FlashBoardGuidedMode';
import { BUILT_IN_PANEL_TYPES } from '../../src/stores/dockStore/panelRegistry';
import { AI_PANEL_TYPES, PANEL_CONFIGS, PANEL_PICKER_HIDDEN_TYPES } from '../../src/types/dock';

afterEach(() => {
  setFlashBoardGuidedMode(false);
  vi.restoreAllMocks();
});

describe('Storyboard directing controls', () => {
  it('labels the automatic Direct path clearly in development', () => {
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

    expect(screen.getByRole('button', { name: 'Prompt path: Direkt' })).toHaveAttribute('data-value', 'automatic');
  });

  it('offers only Direct and Story paths', () => {
    const onDecisionPolicyChange = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Send"
      chatButtonTitle="Send prompt"
      chatPanelOpen
      decisionPolicy="automatic"
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
    fireEvent.click(screen.getByRole('button', { name: 'Prompt path: Direkt' }));
    expect(screen.getByRole('menuitemradio', { name: 'Direkt' })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: 'Story' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Guided' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio', { name: 'Every choice' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Story' }));
    expect(onDecisionPolicyChange).toHaveBeenCalledWith('milestones');
  });

  it('registers Story as a user-visible dock panel', () => {
    expect(BUILT_IN_PANEL_TYPES).toContain('story');
    expect(AI_PANEL_TYPES).toContain('story');
    expect(PANEL_PICKER_HIDDEN_TYPES).not.toContain('story');
    expect(PANEL_CONFIGS.story).toMatchObject({ title: 'Story', minWidth: 320 });
  });

  it('can switch from Story back to Direct', () => {
    const onDecisionPolicyChange = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Chat"
      chatButtonTitle="Send chat prompt"
      chatPanelOpen
      decisionPolicy="milestones"
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={vi.fn()}
      onDecisionPolicyChange={onDecisionPolicyChange}
      onGenerate={vi.fn()}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Prompt path: Story' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Direkt' }));
    expect(onDecisionPolicyChange).toHaveBeenCalledWith('automatic');
  });

  it('starts the Story path from the shared Chat button', () => {
    const onChatButtonClick = vi.fn();
    const onSeedanceStart = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Start"
      chatButtonTitle="Start guided edit"
      chatPanelOpen
      decisionPolicy="milestones"
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={onChatButtonClick}
      onGenerate={vi.fn()}
      onSeedanceStart={onSeedanceStart}
    />);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(onSeedanceStart).toHaveBeenCalledOnce();
    expect(onChatButtonClick).not.toHaveBeenCalled();
  });

  it('keeps Direct on normal chat without a separate Story button', () => {
    const onChatButtonClick = vi.fn();
    const onSeedanceStart = vi.fn();
    render(<FlashBoardActionStack
      canGenerate
      chatButtonLabel="Chat"
      chatButtonTitle="Send chat prompt"
      chatPanelOpen
      generateButtonLabel="Generate"
      generateButtonTitle="Generate"
      isChatting={false}
      onChatButtonClick={onChatButtonClick}
      onGenerate={vi.fn()}
      onSeedanceStart={onSeedanceStart}
    />);

    expect(screen.queryByRole('button', { name: 'Story' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Chat' }));
    expect(onChatButtonClick).toHaveBeenCalledOnce();
    expect(onSeedanceStart).not.toHaveBeenCalled();
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
      requestedModelClass: 'very-fast',
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
