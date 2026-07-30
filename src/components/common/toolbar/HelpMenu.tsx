import type { ToolbarMenuController } from './menuTypes';

const COMMUNITY_LINKS = {
  discord: 'https://discord.com/invite/K8dApzG3XC',
  issue: 'https://github.com/Sportinger/MasterSelects/issues/new/choose',
  reddit: 'https://www.reddit.com/r/masterselects/',
} as const;

interface HelpMenuProps extends ToolbarMenuController {
  closeMenu: () => void;
  devChatUnreadCount: number;
  onOpenDevChat: () => void;
  onOpenLeaveNote: () => void;
}

export function HelpMenu({
  closeMenu,
  devChatUnreadCount,
  onMenuClick,
  onMenuHover,
  onOpenDevChat,
  onOpenLeaveNote,
  openMenu,
}: HelpMenuProps) {
  const hasUnreadDevChat = devChatUnreadCount > 0;

  const openDevChat = () => {
    closeMenu();
    onOpenDevChat();
  };

  const openLeaveNote = () => {
    closeMenu();
    onOpenLeaveNote();
  };

  return (
    <div className="menu-item">
      <button
        className={`menu-trigger help-menu-trigger ${openMenu === 'help' ? 'active' : ''}${hasUnreadDevChat ? ' has-dev-chat-unread' : ''}`}
        onClick={() => onMenuClick('help')}
        onMouseEnter={() => onMenuHover('help')}
        title={hasUnreadDevChat ? 'New reply from the developer' : undefined}
        type="button"
      >
        <span className="help-menu-trigger-label">HELP!</span>
        {hasUnreadDevChat && (
          <>
            <span className="help-menu-unread-indicator" aria-hidden="true">
              <span />
            </span>
            <span className="sr-only">
              {devChatUnreadCount === 1
                ? '1 unread developer reply'
                : `${devChatUnreadCount} unread developer replies`}
            </span>
          </>
        )}
      </button>
      {openMenu === 'help' && (
        <div className="menu-dropdown help-menu-dropdown" aria-label="Help menu">
          <button
            className="menu-option"
            onClick={openDevChat}
            type="button"
          >
            <span>Chat with dev</span>
            {hasUnreadDevChat && (
              <span className="help-menu-unread-badge">
                {devChatUnreadCount > 9 ? '9+' : devChatUnreadCount} new
              </span>
            )}
          </button>
          <button className="menu-option" onClick={openLeaveNote} type="button">
            <span>Leave note</span>
          </button>
          <a
            className="menu-option"
            href={COMMUNITY_LINKS.issue}
            onClick={closeMenu}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>Write issue</span>
          </a>
          <div className="menu-separator" />
          <a
            className="menu-option"
            href={COMMUNITY_LINKS.discord}
            onClick={closeMenu}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>Discord</span>
          </a>
          <a
            className="menu-option"
            href={COMMUNITY_LINKS.reddit}
            onClick={closeMenu}
            rel="noopener noreferrer"
            target="_blank"
          >
            <span>Reddit</span>
          </a>
        </div>
      )}
    </div>
  );
}
