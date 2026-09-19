import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InfoMenu } from '../../src/components/common/toolbar/InfoMenu';
import { APP_VERSION } from '../../src/version';

const renderInfoMenu = (devChatUnreadCount: number) => {
  const closeMenu = vi.fn();
  const onOpenDevChat = vi.fn();

  render(
    <InfoMenu
      closeMenu={closeMenu}
      devChatUnreadCount={devChatUnreadCount}
      onMenuClick={vi.fn()}
      onMenuHover={vi.fn()}
      onOpenDevChat={onOpenDevChat}
      onOpenLeaveNote={vi.fn()}
      openMenu="info"
      setShowLegalDialog={vi.fn()}
    />,
  );

  return { closeMenu, onOpenDevChat };
};

describe('InfoMenu community actions and developer chat notification', () => {
  it('shows Info +1 and the actual unread count when developer replies are unread', () => {
    const { closeMenu, onOpenDevChat } = renderInfoMenu(2);

    expect(screen.getByRole('button', { name: 'Info +1' })).toHaveAttribute(
      'title',
      'New reply from the developer',
    );
    expect(screen.getByText('2 new')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: /Chat with dev/ }));

    expect(closeMenu).toHaveBeenCalledOnce();
    expect(onOpenDevChat).toHaveBeenCalledOnce();
  });

  it('keeps community links in Info without an unread suffix when all messages are read', () => {
    const { closeMenu } = renderInfoMenu(0);

    expect(screen.getByRole('button', { name: 'Info' })).not.toHaveAttribute('title');
    expect(screen.getByLabelText(`Version ${APP_VERSION}`)).toHaveTextContent(`v${APP_VERSION}`);
    const documentationLink = screen.getByRole('menuitem', { name: 'Documentation' });
    expect(documentationLink).toHaveAttribute('href', 'https://www.masterselects.com/docs/');
    expect(documentationLink).toHaveAttribute('target', '_blank');
    expect(documentationLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(screen.getByRole('button', { name: 'Help' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('button', { name: 'Social' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('button', { name: 'Tutorials' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('button', { name: 'Legal' })).toHaveAttribute('aria-haspopup', 'menu');
    expect(screen.getByRole('menuitem', { name: 'Discord' })).toHaveAttribute(
      'href',
      'https://discord.com/invite/K8dApzG3XC',
    );
    expect(screen.getByRole('menuitem', { name: 'Reddit' })).toHaveAttribute(
      'href',
      'https://www.reddit.com/r/masterselects/',
    );
    expect(screen.getByRole('menuitem', { name: 'Insta' })).toBeDisabled();

    fireEvent.click(documentationLink);
    expect(closeMenu).toHaveBeenCalledOnce();
  });
});
