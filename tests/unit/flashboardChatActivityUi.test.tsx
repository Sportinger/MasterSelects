import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardChatOutput } from '../../src/components/panels/flashboard/FlashBoardChatOutput';
import type { AgentActivityEvent } from '../../src/services/flashboard/FlashBoardChatTypes';

const activityEvents: AgentActivityEvent[] = [
  {
    id: 'narration-1',
    runId: 'run-1',
    kind: 'narration',
    source: 'model',
    phase: 'inspecting',
    roundIndex: 0,
    text: 'I am checking the selected range first.',
    createdAt: 1,
  },
  {
    id: 'operation-1',
    runId: 'run-1',
    kind: 'operation',
    source: 'runtime',
    phase: 'completed',
    safeLabel: 'Read timeline',
    toolName: 'getTimelineState',
    createdAt: 2,
  },
  {
    id: 'narration-2',
    runId: 'run-1',
    kind: 'narration',
    source: 'model',
    phase: 'verifying',
    roundIndex: 1,
    text: 'The edit is ready; I am verifying the result.',
    createdAt: 3,
  },
];

function renderOutput(isPending: boolean) {
  return render(
    <FlashBoardChatOutput
      chatError={null}
      chatHistoryRef={createRef<HTMLDivElement>()}
      copiedChatMessageId={null}
      messages={[{
        id: 'assistant-1',
        role: 'assistant',
        text: isPending ? 'AI thinking...' : 'The selected range is now shorter.',
        isPending,
        activityEvents,
      }]}
      onAuthClick={vi.fn()}
      onMessageDoubleClick={vi.fn()}
      onPricingClick={vi.fn()}
      showChatCloudActions={false}
    />,
  );
}

describe('FlashBoard narrated activity UI', () => {
  it('shows the newest narration and an open chronological log while active', () => {
    const { container } = renderOutput(true);

    const liveUpdate = container.querySelector('[aria-live="polite"]');
    expect(liveUpdate).toHaveTextContent('The edit is ready; I am verifying the result.');
    expect(container.querySelector('.fb-chat-output')).not.toHaveAttribute('aria-live');
    expect(screen.queryByText('AI thinking...')).not.toBeInTheDocument();

    const entries = Array.from(container.querySelectorAll('.fb-chat-activity-entries li'))
      .map((entry) => entry.textContent);
    expect(entries).toEqual([
      expect.stringContaining('I am checking the selected range first.'),
      expect.stringContaining('Read timeline completed'),
      expect.stringContaining('The edit is ready; I am verifying the result.'),
    ]);
  });

  it('keeps final text visible and collapses the work log after completion', () => {
    const { container } = renderOutput(false);

    expect(screen.getByText('The selected range is now shorter.')).toBeInTheDocument();
    const details = container.querySelector('details.fb-chat-activity');
    expect(details).not.toHaveAttribute('open');
    expect(details).toHaveTextContent('Work log 3');

    fireEvent.click(screen.getByText(/Work log/));
    expect(details).toHaveAttribute('open');
  });

  it('lets a later authoritative runtime failure replace optimistic narration in the live headline', () => {
    const failedEvent: AgentActivityEvent = {
      id: 'operation-failed',
      runId: 'run-1',
      kind: 'operation',
      source: 'runtime',
      phase: 'failed',
      safeLabel: 'Prepare option C',
      toolName: 'materializeTimelineVariantOption',
      createdAt: 4,
    };
    const { container } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={{ current: null }}
        copiedChatMessageId={null}
        messages={[{
          id: 'pending-runtime-failure',
          role: 'assistant',
          text: 'AI thinking...',
          isPending: true,
          activityEvents: [...activityEvents, failedEvent],
        }]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );
    expect(container.querySelector('[aria-live="polite"]'))
      .toHaveTextContent('Prepare option C failed');
  });
});
