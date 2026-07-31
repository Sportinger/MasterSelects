import { createRef } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlashBoardChatOutput } from '../../src/components/panels/flashboard/FlashBoardChatOutput';
import { canCopyFlashBoardChatMessage } from '../../src/components/panels/flashboard/FlashBoardChatMessageCopy';

describe('FlashBoard chat message copy', () => {
  it('allows completed user and assistant messages, but not transient or error messages', () => {
    expect(canCopyFlashBoardChatMessage({ id: 'user-1', role: 'user', text: 'Cut the silence.' }))
      .toBe(true);
    expect(canCopyFlashBoardChatMessage({ id: 'assistant-1', role: 'assistant', text: 'Done.' }))
      .toBe(true);
    expect(canCopyFlashBoardChatMessage({
      id: 'pending-1',
      role: 'assistant',
      text: 'Thinking...',
      isPending: true,
    })).toBe(false);
    expect(canCopyFlashBoardChatMessage({
      id: 'error-1',
      role: 'assistant',
      text: 'Failed.',
      isError: true,
    })).toBe(false);
  });

  it('makes a YOU bubble copyable by double-click and shows the copied feedback', () => {
    const onMessageDoubleClick = vi.fn();
    const message = { id: 'user-1', role: 'user' as const, text: 'Cut the silence.' };
    const { rerender } = render(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId={null}
        messages={[message]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={onMessageDoubleClick}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );

    const bubble = screen.getByText('Cut the silence.').closest('.fb-chat-message');
    expect(bubble).toHaveClass('is-copyable');
    expect(bubble).toHaveAttribute('title', 'Double-click to copy prompt');
    fireEvent.doubleClick(bubble!);
    expect(onMessageDoubleClick).toHaveBeenCalledWith(message);

    rerender(
      <FlashBoardChatOutput
        chatError={null}
        chatHistoryRef={createRef<HTMLDivElement>()}
        copiedChatMessageId="user-1"
        messages={[message]}
        onAuthClick={vi.fn()}
        onMessageDoubleClick={onMessageDoubleClick}
        onPricingClick={vi.fn()}
        showChatCloudActions={false}
      />,
    );
    expect(screen.getByText('Copied')).toBeInTheDocument();
  });
});
