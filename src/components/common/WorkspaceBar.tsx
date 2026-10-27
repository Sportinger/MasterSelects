import { IconDeviceMobile, IconDeviceTablet, IconLayoutGrid } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';

import {
  FACTORY_START_LAYOUT_ID,
  getVisibleSubLayoutId,
  getWorkspaceOverLayout,
  isWorkspaceOverLayoutId,
  useDockStore,
} from '../../stores/dockStore';
import type { SavedDockLayout } from '../../types/dock';
import { APP_VERSION } from '../../version';
import { WorkspacePageIcon } from './WorkspacePageIcon';
import { openPhoneEditor } from './openPhoneEditor';
import { isPhoneSizedTouchDevice, readPhoneEntryEnvironment } from '../../routing/phoneEntry';
import './WorkspaceBar.css';

function getVisibleLayouts(layouts: SavedDockLayout[]): SavedDockLayout[] {
  return layouts.filter((layout) => !isWorkspaceOverLayoutId(layout.id));
}

interface WorkspaceButtonProps {
  active: boolean;
  layout: SavedDockLayout;
  onSelect: (layoutId: string) => void;
}

function WorkspaceButton({ active, layout, onSelect }: WorkspaceButtonProps) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={`workspace-bar-mode toolbar-layout-switch${active ? ' active' : ''}`}
      data-layout-id={layout.id}
      onClick={() => onSelect(layout.id)}
      onPointerUp={(event) => event.currentTarget.blur()}
      title={`Load ${layout.name}`}
      type="button"
    >
      <WorkspacePageIcon layoutId={layout.id} size={20} />
      <span>{layout.name}</span>
    </button>
  );
}

export function WorkspaceBar() {
  const {
    activeSavedLayoutId,
    loadSavedLayout,
    mediumLayoutOverride,
    mobileLayoutOverride,
    overLayoutBaseId,
    savedLayouts,
    setMediumLayoutOverride,
    setMobileLayoutOverride,
  } = useDockStore(useShallow((state) => ({
    activeSavedLayoutId: state.activeSavedLayoutId,
    loadSavedLayout: state.loadSavedLayout,
    mediumLayoutOverride: state.mediumLayoutOverride,
    mobileLayoutOverride: state.mobileLayoutOverride,
    overLayoutBaseId: state.overLayoutBaseId,
    savedLayouts: state.savedLayouts,
    setMediumLayoutOverride: state.setMediumLayoutOverride,
    setMobileLayoutOverride: state.setMobileLayoutOverride,
  })));
  const [menuOpen, setMenuOpen] = useState(false);
  const [phoneEditorOpening, setPhoneEditorOpening] = useState(false);
  const [phoneEditorError, setPhoneEditorError] = useState<string | null>(null);
  const menuRootRef = useRef<HTMLDivElement>(null);
  const activeOverLayout = getWorkspaceOverLayout(activeSavedLayoutId);
  const mediumLayoutEnabled = mediumLayoutOverride ?? (activeOverLayout === 'medium');
  const mobileLayoutEnabled = mobileLayoutOverride ?? (activeOverLayout === 'mobile');
  const overLayoutsAvailable = activeSavedLayoutId !== FACTORY_START_LAYOUT_ID;
  const visibleActiveLayoutId = getVisibleSubLayoutId(activeSavedLayoutId, overLayoutBaseId);
  const visibleLayouts = useMemo(() => getVisibleLayouts(savedLayouts), [savedLayouts]);
  const favoriteLayouts = useMemo(
    () => visibleLayouts.filter((layout) => layout.favorite === true),
    [visibleLayouts],
  );

  useEffect(() => {
    if (!menuOpen) return undefined;

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [menuOpen]);

  // Mobile opens the phone editor. On a tablet the automatic Mobile dock layout still turns off here;
  // on a phone one tap always goes back to the phone editor.
  const mobileOpensPhoneEditor = !mobileLayoutEnabled || isPhoneSizedTouchDevice(readPhoneEntryEnvironment());
  const toggleMobile = async () => {
    if (!mobileOpensPhoneEditor) {
      setMobileLayoutOverride(false);
      return;
    }
    if (phoneEditorOpening) return;
    setPhoneEditorOpening(true);
    setPhoneEditorError(null);
    const result = await openPhoneEditor();
    if (!result.ok) {
      setPhoneEditorError(result.message);
      setPhoneEditorOpening(false);
    }
  };

  const selectLayout = (layoutId: string) => {
    loadSavedLayout(layoutId);
    setMenuOpen(false);
  };

  return (
    <nav aria-label="Workspaces" className="workspace-bar">
      <div aria-hidden="true" className="workspace-bar-brand">
        <span className="workspace-bar-brand-mark">M</span>
        <span className="workspace-bar-brand-label">
          MasterSelects <span className="workspace-bar-brand-version">{APP_VERSION}</span>
        </span>
      </div>

      <div aria-label="Favorite workspaces" className="workspace-bar-modes" role="group">
        {favoriteLayouts.map((layout) => (
          <WorkspaceButton
            active={layout.id === visibleActiveLayoutId}
            key={layout.id}
            layout={layout}
            onSelect={selectLayout}
          />
        ))}
      </div>

      <div className="workspace-bar-layouts" ref={menuRootRef}>
        <button
          aria-label="Medium mode"
          aria-pressed={mediumLayoutEnabled}
          className="workspace-bar-over-layout-toggle workspace-bar-medium-toggle"
          disabled={!overLayoutsAvailable}
          onClick={() => setMediumLayoutOverride(!mediumLayoutEnabled)}
          onPointerUp={(event) => event.currentTarget.blur()}
          title={mediumLayoutEnabled ? 'Disable Medium design' : 'Enable Medium design'}
          type="button"
        >
          <IconDeviceTablet aria-hidden="true" size={17} stroke={1.7} />
          <span>Medium</span>
        </button>

        <button
          aria-label="Mobile mode"
          aria-pressed={mobileLayoutEnabled}
          className="workspace-bar-over-layout-toggle workspace-bar-mobile-toggle"
          disabled={mobileOpensPhoneEditor ? phoneEditorOpening : !overLayoutsAvailable}
          onClick={() => void toggleMobile()}
          onPointerUp={(event) => event.currentTarget.blur()}
          title={mobileOpensPhoneEditor ? (phoneEditorError ?? 'Open the phone editor') : 'Disable Mobile design'}
          type="button"
        >
          <IconDeviceMobile aria-hidden="true" size={17} stroke={1.7} />
          <span>Mobile</span>
        </button>
        {phoneEditorError ? (
          <span className="workspace-bar-mobile-error" role="alert">{phoneEditorError}</span>
        ) : null}

        <button
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={`workspace-bar-layouts-trigger${menuOpen ? ' active' : ''}`}
          onClick={() => setMenuOpen((open) => !open)}
          onPointerUp={(event) => event.currentTarget.blur()}
          title="All layouts"
          type="button"
        >
          <IconLayoutGrid aria-hidden="true" size={16} stroke={1.7} />
          <span>Layouts</span>
        </button>

        {menuOpen && (
          <div aria-label="All layouts" className="workspace-bar-layouts-menu" role="menu">
            {visibleLayouts.map((layout) => {
              const active = layout.id === visibleActiveLayoutId;
              return (
                <button
                  aria-checked={active}
                  className={active ? 'active' : undefined}
                  key={layout.id}
                  onClick={() => selectLayout(layout.id)}
                  onPointerUp={(event) => event.currentTarget.blur()}
                  role="menuitemradio"
                  type="button"
                >
                  <WorkspacePageIcon layoutId={layout.id} size={16} />
                  <span>{layout.name}</span>
                  {layout.favorite && (
                    <span aria-hidden="true" className="workspace-bar-favorite" title="Favorite">★</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </nav>
  );
}
