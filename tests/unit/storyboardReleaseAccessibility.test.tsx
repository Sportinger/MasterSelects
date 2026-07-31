import { createRef } from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FlashBoardChatOutput } from '../../src/components/panels/flashboard/FlashBoardChatOutput';
import { StoryboardVariantComparisonTray } from '../../src/components/storyboard/variants';
import { createStoryboardDecisionRecord } from '../../src/services/storyboard/decisions';
import {
  resetStoryboardProjectState,
  useStoryboardStore,
} from '../../src/stores/storyboardStore';
import { createReleasePendingActivityMessage } from '../fixtures/storyboard/releaseActivity';
import { createStoryboardReleaseJourneyFixture } from '../fixtures/storyboard/releaseJourney';

afterEach(cleanup);

describe('storyboard release accessibility journey', () => {
  beforeEach(() => {
    resetStoryboardProjectState();
  });

  it('supports keyboard decision choice while exposing runtime truth after narration', async () => {
    const user = userEvent.setup();
    const decision = createStoryboardDecisionRecord({
      id: 'release-accessible-decision',
      kind: 'variant',
      question: 'Choose one of three marked-range options.',
      baseFingerprint: {
        schemaVersion: 1,
        algorithm: 'sha-256',
        value: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
      options: [
        {
          id: 'release-option-a',
          title: 'Balanced',
          summary: 'Preserve clarity.',
          tradeoffs: ['Less energy'],
        },
        {
          id: 'release-option-b',
          title: 'Dynamic',
          summary: 'Increase momentum.',
          tradeoffs: ['Denser pacing'],
        },
        {
          id: 'release-option-c',
          title: 'Alternative',
          summary: 'Change the visual angle.',
          tradeoffs: ['More generation work'],
        },
      ],
      allowMultiple: false,
      allowFreeform: true,
    }, { createdAt: 10 });
    useStoryboardStore.getState().putDecision(decision);
    const onDecisionSubmit = vi.fn();
    const message = {
      ...createReleasePendingActivityMessage(),
      decisionId: decision.id,
    };

    const { container } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        isChatting={false}
        messages={[message]}
        onAuthClick={vi.fn()}
        onDecisionSubmit={onDecisionSubmit}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    const log = screen.getByRole('region', { name: 'AI work log' });
    expect(within(log).getAllByText('Prepare option C failed')).toHaveLength(2);
    expect(container.querySelector('[aria-live="polite"]'))
      .toHaveTextContent('Prepare option C failed');
    const entries = Array.from(
      container.querySelectorAll('.fb-chat-activity-entries li'),
    ).map((entry) => entry.textContent);
    expect(entries.at(-1)).toContain('Prepare option C failed');
    expect(container.querySelector('.fb-chat-activity-entries li.is-operation.is-failed'))
      .toHaveTextContent('Prepare option C failed');

    const dynamic = screen.getByRole('radio', { name: /Dynamic/i });
    dynamic.focus();
    await user.keyboard('[Space]');
    await user.click(screen.getByRole('button', {
      name: /Continue with selection/i,
    }));
    expect(onDecisionSubmit).toHaveBeenCalledWith({
      decisionId: decision.id,
      optionIds: ['release-option-b'],
    });
  });

  it('exposes three partially ready options as tabs with synchronized controls', async () => {
    const user = userEvent.setup();
    const fixture = await createStoryboardReleaseJourneyFixture();
    const options = fixture.options.map((option, index) => ({
      ...option,
      state: index === 0 ? 'ready' as const : index === 1
        ? 'building' as const
        : 'failed' as const,
      ...(index < 2
        ? { materializedCompositionId: `release-composition-${index}` }
        : {}),
    }));
    const onOptionSelect = vi.fn();
    const onAccept = vi.fn();

    render(
      <StoryboardVariantComparisonTray
        activeOptionId={options[0].id}
        candidates={fixture.candidates}
        isPlaying={false}
        loop
        onAccept={onAccept}
        onOptionSelect={onOptionSelect}
        onPlayPause={vi.fn()}
        onRefine={vi.fn()}
        onReject={vi.fn()}
        onSeek={vi.fn()}
        onToggleLoop={vi.fn()}
        options={options}
        playhead={12}
        variantSet={{ ...fixture.variantSet, status: 'review' }}
      />,
    );

    const tray = screen.getByRole('region', {
      name: /Timeline variants: Release range options/i,
    });
    const tabs = within(tray).getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveTextContent('Partially playable');
    expect(tabs[2]).toBeDisabled();

    tabs[1].focus();
    await user.keyboard('[Enter]');
    expect(onOptionSelect).toHaveBeenCalledWith('release-option-b');
    expect(within(tray).getByRole('slider', { name: 'Variant playhead' }))
      .toHaveAttribute('aria-valuetext', '00:12.0');
    expect(within(tray).getByRole('button', { name: 'Loop' }))
      .toHaveAttribute('aria-pressed', 'true');

    await user.click(within(tray).getByRole('button', {
      name: 'Select for commit',
    }));
    expect(onAccept).toHaveBeenCalledWith('release-option-a');
  });
});
