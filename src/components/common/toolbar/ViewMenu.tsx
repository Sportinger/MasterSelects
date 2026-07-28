import {
  SCOPE_PANEL_TYPES,
  WIP_PANEL_TYPES,
  type PanelType,
  type SavedDockLayout,
} from '../../../types/dock';
import type { ToolbarMenuController } from './menuTypes';
import {
  getViewPanelConfig,
  VIEW_AI_PANEL_TYPES,
  VIEW_CORE_PANEL_TYPES,
  VIEW_WIP_ONLY_PANEL_TYPES,
} from './viewPanelConfig';

interface ViewMenuProps extends ToolbarMenuController {
  activeSavedLayout: SavedDockLayout | null;
  activeSavedLayoutId: string | null;
  activeSavedLayoutProtected: boolean;
  canEditFactoryDockLayouts: boolean;
  defaultSavedLayoutId: string | null;
  isPanelTypeVisible: (type: PanelType) => boolean;
  sortedSavedLayouts: SavedDockLayout[];
  onLoadDefaultLayout: () => void;
  onLoadSavedLayout: (layoutId: string) => void;
  onSaveCurrentLayout: () => void;
  onSaveCurrentNamedLayout: () => void;
  onSaveNamedLayout: () => void;
  onSetDefaultSavedLayout: (layoutId: string) => void;
  onToggleFavoriteSavedLayout: (layoutId: string) => void;
  onToggleViewPanelType: (type: PanelType) => void;
}

function getLayoutHint(
  savedLayout: SavedDockLayout,
  activeSavedLayoutId: string | null,
  defaultSavedLayoutId: string | null,
  canEditFactoryDockLayouts: boolean,
): string {
  const isActiveLayout = savedLayout.id === activeSavedLayoutId;
  const isDefaultLayout = savedLayout.id === defaultSavedLayoutId;
  const isBuiltInLayout = savedLayout.factory === true;

  return [
    isActiveLayout ? 'Current' : null,
    isDefaultLayout ? 'Default' : null,
    isBuiltInLayout && !canEditFactoryDockLayouts ? 'Built-in' : null,
  ].filter(Boolean).join(' / ');
}

interface PanelOptionProps {
  type: PanelType;
  checked?: boolean;
  disabled?: boolean;
  wip?: boolean;
  onToggle?: (type: PanelType) => void;
}

function PanelOption({
  checked = false,
  disabled = false,
  onToggle,
  type,
  wip = false,
}: PanelOptionProps) {
  const config = getViewPanelConfig(type);
  return (
    <button
      className={`menu-option ${wip ? 'menu-option-wip' : ''} ${checked ? 'checked' : ''}`}
      onClick={disabled ? undefined : () => onToggle?.(type)}
      disabled={disabled}
    >
      <span>{checked ? '\u2713 ' : '   '}{config.title}</span>
      {wip && <span className="menu-wip-badge">{'\u{1f41b}'}</span>}
    </button>
  );
}

export function ViewMenu({
  activeSavedLayout,
  activeSavedLayoutId,
  activeSavedLayoutProtected,
  canEditFactoryDockLayouts,
  defaultSavedLayoutId,
  isPanelTypeVisible,
  onLoadDefaultLayout,
  onLoadSavedLayout,
  onMenuClick,
  onMenuHover,
  onSaveCurrentLayout,
  onSaveCurrentNamedLayout,
  onSaveNamedLayout,
  onSetDefaultSavedLayout,
  onToggleFavoriteSavedLayout,
  onToggleViewPanelType,
  openMenu,
  sortedSavedLayouts,
}: ViewMenuProps) {
  return (
    <div className="menu-item">
      <button
        className={`menu-trigger ${openMenu === 'view' ? 'active' : ''}`}
        onClick={() => onMenuClick('view')}
        onMouseEnter={() => onMenuHover('view')}
      >
        View
      </button>
      {openMenu === 'view' && (
        <div className="menu-dropdown menu-dropdown-wide">
          <div className="menu-item-with-submenu">
            <button className="menu-option">
              <span>Panels</span>
            </button>
            <div className="menu-nested-submenu menu-nested-submenu-panels">
              <span className="menu-sublabel">Core</span>
              {VIEW_CORE_PANEL_TYPES.map((type) => (
                <PanelOption
                  key={type}
                  type={type}
                  checked={isPanelTypeVisible(type)}
                  onToggle={onToggleViewPanelType}
                />
              ))}

              <div className="menu-separator" />
              <span className="menu-sublabel">AI</span>
              {VIEW_AI_PANEL_TYPES.map((type) => {
                const isWip = WIP_PANEL_TYPES.includes(type);
                return (
                  <PanelOption
                    key={type}
                    type={type}
                    checked={isPanelTypeVisible(type)}
                    disabled={isWip}
                    wip={isWip}
                    onToggle={onToggleViewPanelType}
                  />
                );
              })}

              <div className="menu-separator" />
              <span className="menu-sublabel">Scopes</span>
              {SCOPE_PANEL_TYPES.map((type) => (
                <PanelOption
                  key={type}
                  type={type}
                  checked={isPanelTypeVisible(type)}
                  onToggle={onToggleViewPanelType}
                />
              ))}

              {VIEW_WIP_ONLY_PANEL_TYPES.length > 0 && (
                <>
                  <div className="menu-separator" />
                  <span className="menu-sublabel">Work in Progress</span>
                  {VIEW_WIP_ONLY_PANEL_TYPES.map((type) => (
                    <PanelOption key={type} type={type} disabled wip />
                  ))}
                </>
              )}
            </div>
          </div>
          <div className="menu-separator" />
          <div className="menu-item-with-submenu">
            <button className="menu-option">
              <span>Layouts</span>
            </button>
            <div className="menu-nested-submenu menu-nested-submenu-layouts">
              <button className="menu-option" onClick={onSaveNamedLayout}>
                <span>Save Current Layout...</span>
              </button>
              <button
                className="menu-option"
                onClick={onSaveCurrentNamedLayout}
                disabled={!activeSavedLayout || activeSavedLayoutProtected}
                title={
                  activeSavedLayoutProtected
                    ? 'Built-in layouts can only be edited on the dev server'
                    : activeSavedLayout
                      ? `Overwrite ${activeSavedLayout.name}`
                      : 'Load or save a named layout first'
                }
              >
                <span>Save to Current Layout</span>
                {activeSavedLayout && <span className="menu-hint">{activeSavedLayout.name}</span>}
              </button>
              <button className="menu-option" onClick={onSaveCurrentLayout}>
                <span>Set Current as Default</span>
              </button>
              <button className="menu-option" onClick={onLoadDefaultLayout}>
                <span>Load Default Layout</span>
              </button>
              <div className="menu-separator" />
              <span className="menu-sublabel">Saved Layouts</span>
              {sortedSavedLayouts.length === 0 ? (
                <span className="menu-empty">No saved layouts</span>
              ) : (
                sortedSavedLayouts.map((savedLayout) => {
                  const isDefaultLayout = savedLayout.id === defaultSavedLayoutId;
                  const isActiveLayout = savedLayout.id === activeSavedLayoutId;
                  const isFavoriteLayout = savedLayout.favorite === true;
                  const layoutHint = getLayoutHint(
                    savedLayout,
                    activeSavedLayoutId,
                    defaultSavedLayoutId,
                    canEditFactoryDockLayouts,
                  );
                  return (
                    <div key={savedLayout.id} className="menu-layout-row">
                      <button
                        className={`menu-layout-favorite-btn ${isFavoriteLayout ? 'active' : ''}`}
                        onClick={() => onToggleFavoriteSavedLayout(savedLayout.id)}
                        title={isFavoriteLayout ? 'Remove from header switcher' : 'Show in header switcher'}
                        type="button"
                        aria-label={`${isFavoriteLayout ? 'Unfavorite' : 'Favorite'} ${savedLayout.name}`}
                      >
                        {isFavoriteLayout ? '\u2605' : '\u2606'}
                      </button>
                      <button
                        className={`menu-option menu-layout-load ${isDefaultLayout ? 'checked' : ''} ${isActiveLayout ? 'current' : ''}`}
                        onClick={() => onLoadSavedLayout(savedLayout.id)}
                        title={savedLayout.name}
                      >
                        <span className="menu-layout-name">{savedLayout.name}</span>
                        {layoutHint && <span className="menu-hint">{layoutHint}</span>}
                      </button>
                      <button
                        className={`menu-layout-default-btn ${isDefaultLayout ? 'active' : ''}`}
                        onClick={() => onSetDefaultSavedLayout(savedLayout.id)}
                        title={isDefaultLayout ? 'Default layout' : 'Set as default'}
                        type="button"
                      >
                        {isDefaultLayout ? 'Default' : 'Set'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
