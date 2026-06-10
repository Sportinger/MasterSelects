import type { RefObject } from 'react';

import type { PanelType } from '../../../types/dock';
import { MULTI_INSTANCE_PANEL_TYPES, PANEL_CONFIGS, WIP_PANEL_TYPES } from '../../../types/dock';
import { sortAddMenuPanelTypes } from './layoutMath';
import type { DockTabContextMenuState } from './useTabPaneMenus';

const CHANGE_TO_PANEL_TYPES = Object.keys(PANEL_CONFIGS) as PanelType[];
const ADD_MENU_PANEL_TYPES = sortAddMenuPanelTypes(CHANGE_TO_PANEL_TYPES, MULTI_INSTANCE_PANEL_TYPES);

interface DockTabMenusProps {
  addMenuRef: RefObject<HTMLDivElement | null>;
  contextMenuRef: RefObject<HTMLDivElement | null>;
  addMenu: { x: number; y: number } | null;
  tabContextMenu: DockTabContextMenuState | null;
  getVisiblePanelTypes: () => PanelType[];
  onAddPanelType: (type: PanelType) => void;
  onHideContextPanel: () => void;
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
  onChangeContextPanelType,
}: DockTabMenusProps) {
  return (
    <>
      {addMenu && (
        <div
          ref={addMenuRef}
          className="dock-tab-add-menu"
          style={{ left: addMenu.x, top: addMenu.y }}
          onContextMenu={(event) => event.preventDefault()}
        >
          {(() => {
            const visibleTypes = new Set(getVisiblePanelTypes());
            return ADD_MENU_PANEL_TYPES.map((type) => {
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
                  onClick={() => onAddPanelType(type)}
                  title={title}
                >
                  <span>{config.title}</span>
                  {isWip && <span className="dock-tab-context-menu-hint">WIP</span>}
                  {isMulti && <span className="dock-tab-context-menu-hint">+1</span>}
                  {!isMulti && isVisible && <span className="dock-tab-context-menu-hint">open</span>}
                </button>
              );
            });
          })()}
        </div>
      )}

      {tabContextMenu && (
        <div
          ref={contextMenuRef}
          className="dock-tab-context-menu"
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
          <div className="dock-tab-context-menu-item dock-tab-context-menu-item--submenu">
            <span>Change to</span>
            <span className="dock-tab-context-menu-chevron">&gt;</span>
            <div className="dock-tab-context-submenu">
              {CHANGE_TO_PANEL_TYPES.map((type) => {
                const config = PANEL_CONFIGS[type];
                const isCurrentType = tabContextMenu.panel.type === type;
                const isWip = WIP_PANEL_TYPES.includes(type);
                return (
                  <button
                    key={type}
                    className={`dock-tab-context-menu-item ${isCurrentType ? 'is-current' : ''}`}
                    type="button"
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
        </div>
      )}
    </>
  );
}
