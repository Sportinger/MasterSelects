import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HelpMenu } from '../../src/components/common/toolbar/HelpMenu';

describe('HelpMenu developer chat notification', () => {
  it('shows an accessible unread indicator and clears through the chat action', () => {
    const closeMenu = vi.fn();
    const onOpenDevChat = vi.fn();

    render(
      <HelpMenu
        closeMenu={closeMenu}
        devChatUnreadCount={2}
        onMenuClick={vi.fn()}
        onMenuHover={vi.fn()}
        onOpenDevChat={onOpenDevChat}
        onOpenLeaveNote={vi.fn()}
        openMenu="help"
      />,
    );

    const helpButton = screen.getByRole('button', {
      name: /HELP!.*2 unread developer replies/,
    });
    expect(helpButton).toHaveClass('has-dev-chat-unread');
    expect(screen.getByText('2 new')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Chat with dev/ }));

    expect(closeMenu).toHaveBeenCalledOnce();
    expect(onOpenDevChat).toHaveBeenCalledOnce();
  });
});
