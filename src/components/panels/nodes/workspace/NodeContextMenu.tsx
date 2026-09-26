import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeGraphNode } from '../../../../services/nodeGraph';
import { NodeMenuItems, searchNodeMenu, type NodeMenuEntry } from './NodeMenuTree';

/** Grace period after the pointer leaves the menu before it closes on its own. */
const MENU_LEAVE_CLOSE_DELAY_MS = 700;
/** Grace period for a freshly opened menu the pointer never enters. */
const MENU_IDLE_CLOSE_DELAY_MS = 1500;

export function NodeContextMenu({
  x,
  y,
  targetNode,
  canDeleteTarget,
  entries,
  error,
  onPublishOutput,
  onClose,
  onDeleteNode,
}: {
  x: number;
  y: number;
  targetNode: NodeGraphNode | null;
  canDeleteTarget: boolean;
  /** Clip stages, effects, graph nodes and controls as nested submenus. */
  entries: NodeMenuEntry[];
  /** Reason the last add failed, e.g. a locked track; the menu stays open. */
  error?: string;
  onPublishOutput?: () => void;
  onClose: () => void;
  onDeleteNode: () => void;
}) {
  const [search, setSearch] = useState('');
  const results = useMemo(() => searchNodeMenu(entries, search), [entries, search]);
  const left = typeof window === 'undefined' ? x : Math.min(x, window.innerWidth - 188);
  const top = typeof window === 'undefined' ? y : Math.min(y, window.innerHeight - 220);
  // Without the pointer over the menu (or any flyout, which are DOM children) it closes shortly:
  // right after opening if it is never entered, and after the pointer leaves unless it returns.
  // A typed search or a shown error keeps it open.
  const leaveTimer = useRef<number | undefined>(undefined);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    leaveTimer.current = window.setTimeout(() => onCloseRef.current(), MENU_IDLE_CLOSE_DELAY_MS);
    return () => window.clearTimeout(leaveTimer.current);
  }, []);
  const keepOpen = Boolean(search.trim() || error);

  return (
    <div
      className="node-workspace-context-backdrop"
      onClick={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        className="node-workspace-context-menu"
        role="menu"
        aria-label="Add node"
        style={{ left: Math.max(8, left), top: Math.max(8, top) }}
        onClick={(event) => event.stopPropagation()}
        onMouseEnter={() => window.clearTimeout(leaveTimer.current)}
        onMouseLeave={() => {
          window.clearTimeout(leaveTimer.current);
          if (!keepOpen) leaveTimer.current = window.setTimeout(onClose, MENU_LEAVE_CLOSE_DELAY_MS);
        }}
      >
        <input
          className="node-workspace-context-search"
          type="search"
          placeholder="Search nodes and effects…"
          aria-label="Search nodes"
          value={search}
          onChange={(event) => { window.clearTimeout(leaveTimer.current); setSearch(event.target.value); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && results.length) results[0].entry.onSelect();
          }}
        />
        {targetNode && !search && (
          <>
            {onPublishOutput && <button type="button" onClick={onPublishOutput}>Show output in timeline</button>}
            <button type="button" disabled={!canDeleteTarget} onClick={onDeleteNode}>Delete Node</button>
            <div className="node-workspace-context-separator" />
          </>
        )}
        {search.trim() ? <div className="node-workspace-context-results">
          {results.map(({ entry, path }) => (
            <button key={entry.id} type="button" title={entry.title} onClick={entry.onSelect}>
              <span>{entry.label}</span><small className="node-workspace-context-path">{path}</small>
            </button>
          ))}
          {!results.length && <span className="node-workspace-context-empty">No nodes found</span>}
        </div> : <>
          <NodeMenuItems entries={entries} />
        </>}
        {error && <p className="node-workspace-context-error" role="alert">{error}</p>}
      </div>
    </div>
  );
}
