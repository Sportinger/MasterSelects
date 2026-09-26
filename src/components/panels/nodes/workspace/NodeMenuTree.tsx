import { useState, type KeyboardEvent, type MouseEvent } from 'react';
import { handleSubmenuHover, handleSubmenuLeave } from '../../media/submenuPosition';

/** Declarative menu model shared by the node workspace context menu and its search. */
export type NodeMenuEntry =
  | { kind: 'item'; id: string; label: string; title?: string; disabled?: boolean; keywords?: string; onSelect: () => void }
  | { kind: 'submenu'; id: string; label: string; title?: string; disabled?: boolean; children: NodeMenuEntry[] }
  | { kind: 'heading'; id: string; label: string };

export interface NodeMenuMatch { entry: Extract<NodeMenuEntry, { kind: 'item' }>; path: string }

/** All selectable items with their submenu path; headings and disabled branches are skipped. */
export function flattenNodeMenu(entries: readonly NodeMenuEntry[], path: string[] = []): NodeMenuMatch[] {
  return entries.flatMap(entry => entry.kind === 'item' ? (entry.disabled ? [] : [{ entry, path: path.join(' › ') }])
    : entry.kind === 'submenu' && !entry.disabled ? flattenNodeMenu(entry.children, [...path, entry.label]) : []);
}

/** Every query term must appear in the label, path or keywords. */
export function searchNodeMenu(entries: readonly NodeMenuEntry[], query: string, limit = 60): NodeMenuMatch[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return [];
  const scored = flattenNodeMenu(entries).flatMap(match => {
    const label = match.entry.label.toLocaleLowerCase();
    const text = `${label} ${match.path} ${match.entry.keywords ?? ''}`.toLocaleLowerCase();
    if (!terms.every(term => text.includes(term))) return [];
    return [{ match, score: label.startsWith(terms[0]) ? 0 : label.includes(terms[0]) ? 1 : 2 }];
  });
  return scored.toSorted((a, b) => a.score - b.score || a.match.entry.label.localeCompare(b.match.entry.label))
    .slice(0, limit).map(item => item.match);
}

const blurAfterPointer = (event: MouseEvent<HTMLButtonElement>) => { if (event.detail > 0) event.currentTarget.blur(); };

export function NodeMenuItems({ entries }: { entries: readonly NodeMenuEntry[] }) {
  return <>{entries.map(entry => entry.kind === 'heading'
    ? <div key={entry.id} className="node-workspace-context-submenu-group"><span>{entry.label}</span></div>
    : entry.kind === 'submenu' ? <NodeMenuSubmenu key={entry.id} entry={entry} />
      : <button key={entry.id} type="button" role="menuitem" disabled={entry.disabled} title={entry.title}
        onClick={event => { blurAfterPointer(event); entry.onSelect(); }}>{entry.label}</button>)}</>;
}

function NodeMenuSubmenu({ entry }: { entry: Extract<NodeMenuEntry, { kind: 'submenu' }> }) {
  const [open, setOpen] = useState(false);
  const firstItem = (root: HTMLElement) => root.querySelector<HTMLButtonElement>(':scope > .context-submenu > button:not(:disabled), :scope > .context-submenu > .node-workspace-context-submenu > button:not(:disabled)');
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const trigger = event.currentTarget.firstElementChild as HTMLButtonElement;
    if ((event.key === 'ArrowRight' || event.key === 'Enter') && event.target === trigger && !entry.disabled) {
      event.preventDefault(); event.stopPropagation(); setOpen(true);
      const root = event.currentTarget;
      requestAnimationFrame(() => firstItem(root)?.focus({ preventScroll: true }));
    } else if ((event.key === 'Escape' || event.key === 'ArrowLeft') && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.focus({ preventScroll: true });
    }
  };
  return <div className={`node-workspace-context-submenu${open ? ' is-open' : ''}`} onKeyDown={onKeyDown}
    onMouseEnter={event => { if (entry.disabled) return; handleSubmenuHover(event); setOpen(true); }}
    onMouseLeave={event => { handleSubmenuLeave(event); setOpen(false); }}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" aria-haspopup="menu" aria-expanded={open} disabled={entry.disabled} title={entry.title}
      onClick={event => {
        // Touch and pen have no hover: a tap opens the flyout in place.
        const root = event.currentTarget.parentElement as HTMLDivElement;
        blurAfterPointer(event);
        if (!open) { handleSubmenuHover({ currentTarget: root } as unknown as MouseEvent<HTMLDivElement>); setOpen(true); }
      }}>{entry.label}</button>
    {!entry.disabled && <div className="node-workspace-context-submenu-list context-submenu" role="menu" aria-label={entry.label}
      style={{ display: open ? 'flex' : 'none' }}>
      <NodeMenuItems entries={entry.children} />
    </div>}
  </div>;
}
