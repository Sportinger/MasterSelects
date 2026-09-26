import { useMemo, useState, useSyncExternalStore, type KeyboardEvent, type MouseEvent } from 'react';
import type { FlockDefinition } from '../../../../types/flock';
import type { NodeGraphLayout, NodeGraphNode } from '../../../../services/nodeGraph';
import { NODE_CATEGORIES, operatorCategoryId } from '../../../../services/operators/operatorTaxonomy';
import { FLOCK_GROUP_OPERATOR_ID, listFlockOperators } from '../../../../services/flock/operators/flockOperatorRegistry';
import { FLOCK_PRESETS } from '../../../../services/flock/presets/flockPresets';
import {
  getFlockPresetLibraryVersion,
  listFlockLibraryPresets,
  subscribeFlockPresetLibrary,
  type FlockLibraryGraphPreset,
  type FlockLibraryGroupPreset,
} from '../../../../services/nodeGraph/flockGroupPresetLibrary';
import { handleSubmenuHover, handleSubmenuLeave } from '../../media/submenuPosition';
import { isNodeBypassable, isNodeBypassed } from '../canvas/canvasGeometry';
import type { FlockGraphActions } from './useFlockGraphActions';

function blurAfterPointer(event: MouseEvent<HTMLButtonElement>): void {
  if (event.detail > 0) event.currentTarget.blur();
}

function useFlockLibraryPresets() {
  const version = useSyncExternalStore(subscribeFlockPresetLibrary, getFlockPresetLibraryVersion, getFlockPresetLibraryVersion);
  return useMemo(() => {
    void version;
    const presets = listFlockLibraryPresets();
    return {
      groups: presets.filter((preset): preset is FlockLibraryGroupPreset => preset.kind === 'group'),
      graphs: presets.filter((preset): preset is FlockLibraryGraphPreset => preset.kind === 'graph'),
    };
  }, [version]);
}

export function FlockNodeContextMenu({
  x,
  y,
  layout,
  definition,
  targetNode,
  selectedNodeIds,
  actions,
  onSelectNodes,
  onClose,
}: {
  x: number;
  y: number;
  layout: NodeGraphLayout;
  definition: FlockDefinition;
  targetNode: NodeGraphNode | null;
  selectedNodeIds: string[];
  actions: FlockGraphActions;
  onSelectNodes: (nodeIds: string[]) => void;
  onClose: () => void;
}) {
  const [groupLabel, setGroupLabel] = useState('Group');
  const [graphLabel, setGraphLabel] = useState('My Flock Graph');
  const library = useFlockLibraryPresets();
  const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 236);
  const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 360);
  const selection = selectedNodeIds.length > 0 ? selectedNodeIds : targetNode ? [targetNode.id] : [];
  const operatorsByCategory = useMemo(() => {
    const operators = listFlockOperators().filter((operator) => operator.id !== FLOCK_GROUP_OPERATOR_ID);
    // The shared node categories (Particles, Forces & Physics, ...), as in the workspace menu.
    return NODE_CATEGORIES
      .map((category) => ({ category: category.id, label: category.label, operators: operators.filter((operator) => operatorCategoryId(operator) === category.id) }))
      .filter((entry) => entry.operators.length > 0);
  }, []);

  const run = (action: () => void) => {
    action();
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return (
    <div
      className="node-workspace-context-backdrop"
      onClick={onClose}
      onKeyDown={handleKeyDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="node-workspace-context-menu node-workspace-flock-menu"
        role="menu"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(event) => event.stopPropagation()}
      >
        {targetNode && (
          <>
            <button type="button" role="menuitem" onClick={() => run(() => {
              const ids = actions.duplicate(selection);
              if (ids.length > 0) onSelectNodes(ids);
            })}>
              Duplicate{selection.length > 1 ? ` ${selection.length} Nodes` : ''}
            </button>
            {isNodeBypassable(targetNode) && (
              <button type="button" role="menuitem" onClick={() => run(() => actions.toggleBypass(targetNode.id))}>
                {isNodeBypassed(targetNode) ? 'Enable Node' : 'Bypass Node'}
              </button>
            )}
            {typeof targetNode.params?.groupRef === 'string' && (
              <button type="button" role="menuitem" onClick={() => run(() => {
                const ids = actions.ungroup(targetNode.id);
                if (ids.length > 0) onSelectNodes(ids);
              })}>
                Ungroup
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => run(() => {
              actions.deleteNodes(selection);
              onSelectNodes([]);
            })}>
              Delete{selection.length > 1 ? ` ${selection.length} Nodes` : ' Node'}
            </button>
            <div className="node-workspace-context-separator" />
          </>
        )}

        {selection.length > 0 && (
          <div className="node-workspace-flock-menu-form">
            <input
              aria-label="Group name"
              value={groupLabel}
              onChange={(event) => setGroupLabel(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
            <div className="node-workspace-flock-menu-form-actions">
              <button type="button" onClick={(event) => {
                blurAfterPointer(event);
                run(() => {
                  const groupNodeId = actions.group(selection, groupLabel.trim() || 'Group');
                  if (groupNodeId) onSelectNodes([groupNodeId]);
                });
              }}>
                Group
              </button>
              <button type="button" onClick={(event) => {
                blurAfterPointer(event);
                run(() => actions.saveGroupPreset(selection, groupLabel.trim() || 'Group'));
              }}>
                Save as Preset
              </button>
            </div>
          </div>
        )}

        <div className="node-workspace-context-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
          <button type="button" aria-haspopup="menu">Add Node</button>
          <div className="node-workspace-context-submenu-list context-submenu">
            {operatorsByCategory.map(({ category, label, operators }) => (
              <div key={category} className="node-workspace-context-submenu-group">
                <span>{label}</span>
                {operators.map((operator) => (
                  <button
                    key={operator.id}
                    type="button"
                    role="menuitem"
                    title={operator.description}
                    onClick={() => run(() => {
                      const nodeId = actions.addOperator(operator.id, layout);
                      if (nodeId) onSelectNodes([nodeId]);
                    })}
                  >
                    {operator.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>

        <div className="node-workspace-context-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
          <button type="button" aria-haspopup="menu">Groups</button>
          <div className="node-workspace-context-submenu-list context-submenu">
            <div className="node-workspace-context-submenu-group">
              <span>In this clip</span>
              {definition.groups.length === 0 && <em className="node-workspace-flock-menu-empty">No groups yet</em>}
              {definition.groups.map((group) => (
                <button key={group.id} type="button" role="menuitem" onClick={() => run(() => {
                  const nodeId = actions.addGroupInstance(group.id, layout);
                  if (nodeId) onSelectNodes([nodeId]);
                })}>
                  {group.label}
                </button>
              ))}
            </div>
            <div className="node-workspace-context-submenu-group">
              <span>Saved group presets</span>
              {library.groups.length === 0 && <em className="node-workspace-flock-menu-empty">None saved</em>}
              {library.groups.map((preset) => (
                <button key={preset.id} type="button" role="menuitem" onClick={() => run(() => {
                  const nodeId = actions.insertGroupPreset(preset, layout);
                  if (nodeId) onSelectNodes([nodeId]);
                })}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="node-workspace-context-submenu" onMouseEnter={handleSubmenuHover} onMouseLeave={handleSubmenuLeave}>
          <button type="button" aria-haspopup="menu">Replace Graph</button>
          <div className="node-workspace-context-submenu-list context-submenu">
            <div className="node-workspace-context-submenu-group">
              <span>Built-in presets</span>
              {FLOCK_PRESETS.map((preset) => (
                <button key={preset.id} type="button" role="menuitem" title={preset.description} onClick={() => run(() => {
                  actions.applyBuiltInPreset(preset.id);
                  onSelectNodes([]);
                })}>
                  {preset.label}
                </button>
              ))}
            </div>
            <div className="node-workspace-context-submenu-group">
              <span>Saved graphs</span>
              {library.graphs.length === 0 && <em className="node-workspace-flock-menu-empty">None saved</em>}
              {library.graphs.map((preset) => (
                <button key={preset.id} type="button" role="menuitem" onClick={() => run(() => {
                  actions.applyGraphPreset(preset);
                  onSelectNodes([]);
                })}>
                  {preset.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="node-workspace-context-separator" />
        <div className="node-workspace-flock-menu-form">
          <input
            aria-label="Graph preset name"
            value={graphLabel}
            onChange={(event) => setGraphLabel(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
          <div className="node-workspace-flock-menu-form-actions">
            <button type="button" onClick={(event) => {
              blurAfterPointer(event);
              run(() => actions.saveGraphPreset(graphLabel.trim() || 'My Flock Graph'));
            }}>
              Save Graph as Preset
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
