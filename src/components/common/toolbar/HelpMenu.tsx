import type { ToolbarMenuController } from './menuTypes';

const COMMUNITY_LINKS = {
  discord: 'https://discord.com/invite/K8dApzG3XC',
  issue: 'https://github.com/Sportinger/MasterSelects/issues/new/choose',
  reddit: 'https://www.reddit.com/r/masterselects/',
} as const;

interface HelpMenuProps extends ToolbarMenuController {
  closeMenu: () => void;
  onOpenLeaveNote: () => void;
}

export function HelpMenu({
  closeMenu,
  onMenuClick,
  onMenuHover,
  onOpenLeaveNote,
  openMenu,
}: HelpMenuProps) {
  const openLeaveNote = () => {
    closeMenu();
    onOpenLeaveNote();
  };

  return (
    <div className="menu-item">
      <button
        className={`menu-trigger help-menu-trigger ${openMenu === 'help' ? 'active' : ''}`}
        onClick={() => onMenuClick('help')}
        onMouseEnter={() => onMenuHover('help')}
        type="button"
      >
        HELP!
      </button>
      {openMenu === 'help' && (
        <div className="menu-dropdown help-menu-dropdown" aria-label="Help menu">
          <button
            className="menu-option"
            disabled
            title="Coming soon"
            type="button"
          >
            <span>Chat with dev</span>
            <span className="menu-hint" aria-hidden="true">Soon</span>
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
