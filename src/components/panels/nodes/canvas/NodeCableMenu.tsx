import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CableMenuState } from './useNodeCableBranches';
import type { RoutedCable } from './cableBranches';
import { NodeMenuItems, searchNodeMenu, type NodeMenuEntry } from '../workspace/NodeMenuTree';
import { useMenuAutoClose } from '../workspace/useMenuAutoClose';
import './NodeGraphBranches.css';

interface Props {
  menu: CableMenuState & { cable: RoutedCable; trunk?: string };
  onClose: () => void;
  onAddBranch: (cableId: string, point: CableMenuState['point']) => void;
  onRemoveBranch: (id: string) => void;
  onDisconnect?: (edgeId: string) => void;
  /** Nodes and node groups that are placed between the cable's ends when chosen. */
  insertEntries?: NodeMenuEntry[];
}

/**
 * Cable context menu: the workspace add menu (search, Nodes, Node Groups) whose choices
 * go between the cable's ends, plus branch and disconnect actions for the cable.
 */
export function NodeCableMenu({ menu, onClose, onAddBranch, onRemoveBranch, onDisconnect, insertEntries }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [search, setSearch] = useState('');
  const entries = useMemo(() => insertEntries ?? [], [insertEntries]);
  const results = useMemo(() => searchNodeMenu(entries, search), [entries, search]);
  const autoClose = useMenuAutoClose(onClose, Boolean(search.trim()));
  useEffect(() => {
    const close = (event: Event) => { if (!(event.target instanceof Node) || !ref.current?.contains(event.target)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', close, true); window.addEventListener('keydown', key, true); window.addEventListener('blur', onClose);
    ref.current?.querySelector<HTMLButtonElement>(':scope > button')?.focus({ preventScroll: true });
    return () => { window.removeEventListener('pointerdown', close, true); window.removeEventListener('keydown', key, true); window.removeEventListener('blur', onClose); };
  }, [onClose]);
  const act = (action: () => void) => () => { action(); onClose(); };
  const edge = menu.cable.edge;
  const actions = [
    !edge?.readOnly && <button key="branch" type="button" role="menuitem" onClick={act(() => onAddBranch(menu.cableId, menu.point))}>Add branch point here</button>,
    menu.trunk && <button key="unbranch" type="button" role="menuitem" onClick={act(() => onRemoveBranch(menu.trunk!))}>Remove branch point</button>,
    edge && !edge.readOnly && onDisconnect && <button key="disconnect" type="button" role="menuitem" onClick={act(() => onDisconnect(edge.id))}>Disconnect</button>,
  ].filter(Boolean);
  const left = Math.max(8, Math.min(menu.clientX, window.innerWidth - 188));
  const top = Math.max(8, Math.min(menu.clientY, window.innerHeight - 220));
  // Portaled: transformed dock panels must not offset the fixed menu position.
  return createPortal(<div ref={ref} className="node-workspace-context-menu node-cable-menu" role="menu" aria-label="Cable"
    style={{ left, top }} onContextMenu={event => event.preventDefault()}
    onMouseEnter={autoClose.onMouseEnter} onMouseLeave={autoClose.onMouseLeave}
    // Choosing a node (from the submenus or the search) inserts it and closes the menu.
    onClick={event => { if (event.target instanceof HTMLElement && event.target.closest('[data-insert-entry], .context-submenu [role="menuitem"]')) onClose(); }}>
    {entries.length > 0 && <input className="node-workspace-context-search" type="search" placeholder="Insert node into cable…"
      aria-label="Search nodes to insert" value={search}
      onChange={event => { autoClose.cancel(); setSearch(event.target.value); }}
      onKeyDown={event => { if (event.key === 'Enter' && results.length) { results[0].entry.onSelect(); onClose(); } }} />}
    {search.trim() ? <div className="node-workspace-context-results">
      {results.map(({ entry, path }) => (
        <button key={entry.id} type="button" data-insert-entry title={entry.title} onClick={entry.onSelect}>
          <span>{entry.label}</span><small className="node-workspace-context-path">{path}</small>
        </button>
      ))}
      {!results.length && <span className="node-workspace-context-empty">No nodes found</span>}
    </div> : <>
      {actions}
      {actions.length > 0 && entries.length > 0 && <div className="node-workspace-context-separator" />}
      <NodeMenuItems entries={entries} />
    </>}
  </div>, document.body);
}
