import { createRef } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

  it('shows streamed assistant text while the work log remains active', () => {
    const { container } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        messages={[{
          activityEvents,
          id: 'assistant-streaming',
          isPending: true,
          isStreaming: true,
          role: 'assistant',
          text: 'This answer is appearing live.',
        }]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    expect(screen.getByText('This answer is appearing live.')).toBeInTheDocument();
    expect(container.querySelector('.fb-chat-message')).toHaveClass('is-streaming');
    expect(container.querySelector('.fb-chat-output-message')).toHaveAttribute('aria-live', 'polite');
    expect(container.querySelector('.fb-chat-activity-log')).toBeInTheDocument();
  });

  it('keeps a dedicated running indicator available outside the scrollable work log', () => {
    const { container } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        isChatting
        messages={[{
          id: 'assistant-running',
          role: 'assistant',
          text: 'AI thinking...',
          isPending: true,
          activityEvents,
        }]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    const indicator = screen.getByRole('status', {
      name: /AI working: The edit is ready; I am verifying the result\., \d+(:\d{2}|s)/,
    });
    expect(indicator).toHaveClass('fb-chat-running-indicator');
    expect(indicator).toHaveTextContent('The edit is ready; I am verifying the result.');
    expect(container.querySelector('.fb-chat-running-elapsed')).toBeInTheDocument();
    expect(container.querySelector('.fb-chat-activity-log')).toBeInTheDocument();
  });

  it('starts counting from submission before the first activity event arrives', () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const view = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        isChatting
        messages={[{
          createdAt: 10_000,
          id: 'assistant-waiting-for-activity',
          role: 'assistant',
          text: 'AI thinking...',
          isPending: true,
        }]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    try {
      expect(view.container.querySelector('.fb-chat-running-elapsed')).toHaveTextContent('0s');
      act(() => vi.advanceTimersByTime(2_100));
      expect(view.container.querySelector('.fb-chat-running-elapsed')).toHaveTextContent('2s');
    } finally {
      view.unmount();
      vi.useRealTimers();
    }
  });

  it('pairs operation lifecycle events and groups repeated parallel tools', () => {
    const operationEvents: AgentActivityEvent[] = [
      ...activityEvents.slice(0, 1),
      ...['shape-a', 'shape-b'].flatMap((operationId, index): AgentActivityEvent[] => ([
        {
          id: `started-${operationId}`,
          runId: 'run-1',
          kind: 'operation',
          source: 'runtime',
          phase: 'started',
          safeLabel: 'Create motion shape clip',
          operationId,
          toolName: 'createMotionShapeClip',
          createdAt: 10 + index,
        },
      ])),
      ...['shape-a', 'shape-b'].map((operationId, index): AgentActivityEvent => ({
        id: `completed-${operationId}`,
        runId: 'run-1',
        kind: 'operation',
        source: 'runtime',
        phase: 'completed',
        safeLabel: 'Create motion shape clip',
        operationId,
        toolName: 'createMotionShapeClip',
        createdAt: 20 + index,
      })),
    ];
    const { container } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        messages={[{
          id: 'assistant-grouped',
          role: 'assistant',
          text: 'Done.',
          activityEvents: operationEvents,
        }]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={vi.fn()}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    const rows = Array.from(container.querySelectorAll('.fb-chat-activity-entries li'));
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Create motion shape clip completed ×2');
    expect(container).not.toHaveTextContent('Create motion shape clip started');
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
