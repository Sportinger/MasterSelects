import type { LegalPage } from '../LegalDialog';
import type { ToolbarMenuController } from './menuTypes';

interface InfoMenuProps extends ToolbarMenuController {
  closeMenu: () => void;
  onOpenChangelog?: () => void;
  onOpenSplash?: () => void;
  setShowLegalDialog: (page: LegalPage) => void;
}

export function InfoMenu({
  closeMenu,
  onMenuClick,
  onMenuHover,
  onOpenChangelog,
  onOpenSplash,
  openMenu,
  setShowLegalDialog,
}: InfoMenuProps) {
  const dispatchAndClose = (eventName: string) => {
    window.dispatchEvent(new CustomEvent(eventName));
    closeMenu();
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
      >
        Info
      </button>
      {openMenu === 'info' && (
        <div className="menu-dropdown">
          <button className="menu-option" onClick={() => dispatchAndClose('open-welcome-screen')}>
            <span>Where are you coming from?</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={() => dispatchAndClose('open-tutorial-campaigns')}>
            <span>Tutorials</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={() => dispatchAndClose('start-tutorial')}>
            <span>Quick Tour</span>
          </button>
          <button className="menu-option" onClick={() => dispatchAndClose('start-timeline-tutorial')}>
            <span>Timeline Tour</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={() => { onOpenChangelog?.(); closeMenu(); }}>
            <span>Changelog</span>
          </button>
          <div className="menu-separator" />
          <button className="menu-option" onClick={() => { onOpenSplash?.(); closeMenu(); }}>
            <span>About</span>
          </button>
          <div className="menu-separator" />
          <a className="menu-option" href="/impressum" rel="noopener noreferrer" target="_blank">
            <span>Imprint</span>
          </a>
          <a className="menu-option" href="/datenschutz" rel="noopener noreferrer" target="_blank">
            <span>Privacy Policy</span>
          </a>
          <button className="menu-option" onClick={() => openLegalDialog('contact')}>
            <span>Contact</span>
          </button>
        </div>
      )}
    </div>
  );
}
