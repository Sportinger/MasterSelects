import type { RefObject } from 'react';

import type { PanelType } from '../../../types/dock';
import {
  MULTI_INSTANCE_PANEL_TYPES,
  PANEL_CONFIGS,
  PANEL_PICKER_HIDDEN_TYPES,
  WIP_PANEL_TYPES,
} from '../../../types/dock';
import {
  getAddPanelSubmenuMode,
  getPanelMenuCascadeMode,
  sortAddMenuPanelTypes,
} from './layoutMath';
import { getPanelMenuGroups } from './panelMenuGroups';
import type { DockTabContextMenuState } from './useTabPaneMenus';

const CHANGE_TO_PANEL_TYPES = (Object.keys(PANEL_CONFIGS) as PanelType[]).filter(
  type => !PANEL_PICKER_HIDDEN_TYPES.includes(type),
);
const ADD_MENU_PANEL_TYPES = sortAddMenuPanelTypes(CHANGE_TO_PANEL_TYPES, MULTI_INSTANCE_PANEL_TYPES);
const CHANGE_TO_PANEL_GROUPS = getPanelMenuGroups(CHANGE_TO_PANEL_TYPES);
const ADD_PANEL_GROUPS = getPanelMenuGroups(ADD_MENU_PANEL_TYPES);

interface DockTabMenusProps {
  addMenuRef: RefObject<HTMLDivElement | null>;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  addMenu: { x: number; y: number } | null;
  tabContextMenu: DockTabContextMenuState | null;
  getVisiblePanelTypes: () => PanelType[];
  onAddPanelType: (type: PanelType) => void;
  onHideContextPanel: () => void;
  onFloatContextPanel: () => void;
  onDetachContextPanelToWindow: () => void;
  onChangeContextPanelType: (type: PanelType) => void;
}

export function DockTabMenus({
  addMenuRef,
  contextMenuRef,
  addMenu,
  tabContextMenu,
  getVisiblePanelTypes,
  onAddPanelType,
  onHideContextPanel,
  onFloatContextPanel,
  onDetachContextPanelToWindow,
  onChangeContextPanelType,
}: DockTabMenusProps) {
  const panelMenuCascadeMode = tabContextMenu
    ? getPanelMenuCascadeMode(tabContextMenu.x, window.innerWidth)
    : 'cascade-right';
  const addPanelSubmenuMode = addMenu
    ? getAddPanelSubmenuMode(addMenu.x, window.innerWidth)
    : 'cascade-right';

  return (
    <>
      {addMenu && (
        <div
          ref={addMenuRef}
          className={`dock-tab-add-menu dock-tab-add-menu--${addPanelSubmenuMode}`}
          style={{ left: addMenu.x, top: addMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
          role="menu"
          aria-label="Add panel category"
        >
          {(() => {
            const visibleTypes = new Set(getVisiblePanelTypes());
            return ADD_PANEL_GROUPS.map((group) => {
              return (
                <div
                  key={group.label}
                  className="dock-tab-add-menu-submenu-trigger"
                  role="none"
                >
                  <button
                    className="dock-tab-add-menu-item"
                    type="button"
                    role="menuitem"
                    aria-haspopup="menu"
                  >
                    <span>{group.label}</span>
                    <span className="dock-tab-context-menu-chevron" aria-hidden="true">&gt;</span>
                  </button>
                  <div
                    className="dock-tab-add-submenu"
                    role="menu"
                    aria-label={`${group.label} panels to add`}
                  >
                    {group.types.map((type) => {
                      const config = PANEL_CONFIGS[type];
                      const isMulti = MULTI_INSTANCE_PANEL_TYPES.includes(type);
                      const isVisible = visibleTypes.has(type);
                      const isWip = WIP_PANEL_TYPES.includes(type);
                      const title = isMulti
                        ? `Add another ${config.title}`
                        : (isVisible ? `${config.title} (focus existing)` : `Add ${config.title}`);
                      return (
                        <button
                          key={type}
                          className={`dock-tab-add-menu-item ${(!isMulti && isVisible) ? 'is-current' : ''}`}
                          type="button"
                          role="menuitem"
                          onClick={() => onAddPanelType(type)}
                          title={title}
                        >
                          <span>{config.title}</span>
                          {isWip && <span className="dock-tab-context-menu-hint">WIP</span>}
                          {isMulti && <span className="dock-tab-context-menu-hint">+1</span>}
                          {!isMulti && isVisible && <span className="dock-tab-context-menu-hint">open</span>}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      )}

      {tabContextMenu && (
        <div
          ref={contextMenuRef}
          className={`dock-tab-context-menu dock-tab-context-menu--${panelMenuCascadeMode}`}
          style={{
            left: tabContextMenu.x,
            top: tabContextMenu.y,
          }}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            className="dock-tab-context-menu-item"
            type="button"
            onClick={onHideContextPanel}
          >
            <span>Hide</span>
          </button>
          <div className="dock-tab-context-menu-submenu-trigger">
            <button
              className="dock-tab-context-menu-item"
              type="button"
              aria-haspopup="menu"
            >
              <span>Change to</span>
              <span className="dock-tab-context-menu-chevron" aria-hidden="true">&gt;</span>
            </button>
            <div
              className="dock-tab-context-submenu dock-tab-context-submenu--categories"
              role="menu"
              aria-label="Change panel category"
            >
              {CHANGE_TO_PANEL_GROUPS.map((group) => {
                const containsCurrentType = group.types.includes(tabContextMenu.panel.type);
                return (
                  <div
                    key={group.label}
                    className="dock-tab-context-menu-submenu-trigger"
                    role="none"
                  >
                    <button
                      className={`dock-tab-context-menu-item ${containsCurrentType ? 'is-current' : ''}`}
                      type="button"
                      role="menuitem"
                      aria-haspopup="menu"
                    >
                      <span>{group.label}</span>
                      <span className="dock-tab-context-menu-chevron" aria-hidden="true">&gt;</span>
                    </button>
                    <div
                      className="dock-tab-context-submenu dock-tab-context-submenu--panels"
                      role="menu"
                      aria-label={`${group.label} panels`}
                    >
                      {group.types.map((type) => {
                        const config = PANEL_CONFIGS[type];
                        const isCurrentType = tabContextMenu.panel.type === type;
                        const isWip = WIP_PANEL_TYPES.includes(type);
                        return (
                          <button
                            key={type}
                            className={`dock-tab-context-menu-item ${isCurrentType ? 'is-current' : ''}`}
                            type="button"
                            role="menuitem"
                            disabled={isCurrentType || isWip}
                            onClick={() => onChangeContextPanelType(type)}
                          >
                            <span>{config.title}</span>
                            {isWip && <span className="dock-tab-context-menu-hint">WIP</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <button
            className="dock-tab-context-menu-item"
            type="button"
            onClick={onFloatContextPanel}
          >
            <span>Undock</span>
          </button>
          <button
            className="dock-tab-context-menu-item"
            type="button"
            onClick={onDetachContextPanelToWindow}
          >
            <span>Undock to Window</span>
          </button>
        </div>
      )}
    </>
  );
}
