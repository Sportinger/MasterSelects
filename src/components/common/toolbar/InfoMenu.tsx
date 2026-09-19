import { APP_VERSION } from '../../../version';
import type { LegalPage } from '../LegalDialog';
import type { ToolbarMenuController } from './menuTypes';

const COMMUNITY_LINKS = {
  discord: 'https://discord.com/invite/K8dApzG3XC',
  issue: 'https://github.com/Sportinger/MasterSelects/issues/new/choose',
  reddit: 'https://www.reddit.com/r/masterselects/',
} as const;

const DOCUMENTATION_URL = 'https://www.masterselects.com/docs/';

interface InfoMenuProps extends ToolbarMenuController {
  closeMenu: () => void;
  devChatUnreadCount: number;
  onOpenDevChat: () => void;
  onOpenLeaveNote: () => void;
  setShowLegalDialog: (page: LegalPage) => void;
}

export function InfoMenu({
  closeMenu,
  devChatUnreadCount,
  onMenuClick,
  onMenuHover,
  onOpenDevChat,
  onOpenLeaveNote,
  openMenu,
  setShowLegalDialog,
}: InfoMenuProps) {
  const hasUnreadDevChat = devChatUnreadCount > 0;

  const dispatchAndClose = (eventName: string) => {
    window.dispatchEvent(new CustomEvent(eventName));
    closeMenu();
  };

  const openDevChat = () => {
    closeMenu();
    onOpenDevChat();
  };

  const openLeaveNote = () => {
    closeMenu();
    onOpenLeaveNote();
  };

  const openLegalDialog = (page: LegalPage) => {
    setShowLegalDialog(page);
    closeMenu();
  };

  return (
    <div className="menu-item">
      <button
        className={`menu-trigger ${openMenu === 'info' ? 'active' : ''}`}
        onClick={() => onMenuClick('info')}
        onMouseEnter={() => onMenuHover('info')}
        title={hasUnreadDevChat ? 'New reply from the developer' : undefined}
        type="button"
      >
        Info{hasUnreadDevChat ? ' +1' : ''}
      </button>
      {openMenu === 'info' && (
        <div className="menu-dropdown info-menu-dropdown" aria-label="Info menu">
          <div className="info-menu-version" aria-label={`Version ${APP_VERSION}`}>
            <span>Version</span>
            <span>v{APP_VERSION}</span>
          </div>
          <div className="menu-separator" />
          <a
            className="menu-option"
            href="/about/"
            onClick={closeMenu}
            rel="noopener noreferrer"
            role="menuitem"
            target="_blank"
          >
            <span>About MasterSelects</span>
          </a>
          <a
            className="menu-option"
            href={DOCUMENTATION_URL}
            onClick={closeMenu}
            rel="noopener noreferrer"
            role="menuitem"
            target="_blank"
          >
            <span>Documentation</span>
          </a>
          <div className="menu-item-with-submenu">
            <button className="menu-option" aria-haspopup="menu" type="button">
              <span>Help</span>
            </button>
            <div className="menu-nested-submenu info-menu-nested-submenu" role="menu">
              <button className="menu-option" onClick={openDevChat} role="menuitem" type="button">
                <span>Chat with dev</span>
                {hasUnreadDevChat && (
                  <span className="info-menu-unread-badge">
                    {devChatUnreadCount > 9 ? '9+' : devChatUnreadCount} new
                  </span>
                )}
              </button>
              <button className="menu-option" onClick={openLeaveNote} role="menuitem" type="button">
                <span>Leave note</span>
              </button>
              <a
                className="menu-option"
                href={COMMUNITY_LINKS.issue}
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Write issue</span>
              </a>
            </div>
          </div>
          <div className="menu-item-with-submenu">
            <button className="menu-option" aria-haspopup="menu" type="button">
              <span>Social</span>
            </button>
            <div className="menu-nested-submenu info-menu-nested-submenu" role="menu">
              <a
                className="menu-option"
                href={COMMUNITY_LINKS.discord}
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Discord</span>
              </a>
              <a
                className="menu-option"
                href={COMMUNITY_LINKS.reddit}
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Reddit</span>
              </a>
              <button className="menu-option" disabled role="menuitem" type="button">
                <span>Insta</span>
              </button>
            </div>
          </div>
          <div className="menu-item-with-submenu">
            <button className="menu-option" aria-haspopup="menu" type="button">
              <span>Tutorials</span>
            </button>
            <div className="menu-nested-submenu info-menu-nested-submenu" role="menu">
              <button
                className="menu-option"
                onClick={() => dispatchAndClose('start-tutorial')}
                role="menuitem"
                type="button"
              >
                <span>Workspace Tour</span>
              </button>
            </div>
          </div>
          <div className="menu-item-with-submenu">
            <button className="menu-option" aria-haspopup="menu" type="button">
              <span>Legal</span>
            </button>
            <div className="menu-nested-submenu info-menu-nested-submenu" role="menu">
              <a
                className="menu-option"
                href="/impressum"
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Imprint</span>
              </a>
              <a
                className="menu-option"
                href="/datenschutz"
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Privacy Policy</span>
              </a>
              <a
                className="menu-option"
                href="/agb"
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Terms</span>
              </a>
              <a
                className="menu-option"
                href="/widerruf"
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Withdrawal</span>
              </a>
              <a
                className="menu-option"
                href="/kuendigen"
                onClick={closeMenu}
                rel="noopener noreferrer"
                role="menuitem"
                target="_blank"
              >
                <span>Cancel contracts here</span>
              </a>
              <button
                className="menu-option"
                onClick={() => openLegalDialog('contact')}
                role="menuitem"
                type="button"
              >
                <span>Contact</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
