import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';

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

/** Selectable entries below a submenu, shown next to its label. */
export function countNodeMenuItems(entries: readonly NodeMenuEntry[]): number {
  return entries.reduce((sum, entry) => sum + (entry.kind === 'item' ? 1 : entry.kind === 'submenu' ? countNodeMenuItems(entry.children) : 0), 0);
}

const blurAfterPointer = (event: MouseEvent<HTMLButtonElement>) => { if (event.detail > 0) event.currentTarget.blur(); };

/** Grace period before an open flyout closes after the pointer leaves the menu. */
const LEAVE_CLOSE_DELAY_MS = 450;
/** Grace period while the pointer crosses sibling rows on its way into the open flyout. */
const AIM_SWITCH_DELAY_MS = 350;

type Point = { x: number; y: number };

/** True when the pointer is travelling from `from` into the triangle spanned towards the flyout's near edge. */
function isAimingAtFlyout(from: Point | undefined, to: Point, flyout: HTMLElement): boolean {
  if (!from) return false;
  const rect = flyout.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const edgeX = rect.left >= to.x ? rect.left : rect.right <= to.x ? rect.right : null;
  if (edgeX === null) return false;
  const a = from, b = { x: edgeX, y: rect.top - 12 }, c = { x: edgeX, y: rect.bottom + 12 };
  const side = (p: Point, q: Point, r: Point) => (p.x - r.x) * (q.y - r.y) - (q.x - r.x) * (p.y - r.y);
  const d1 = side(to, a, b), d2 = side(to, b, c), d3 = side(to, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Fixed flyout placement next to its row; fixed boxes never add scrollable overflow to the parent list. */
function positionFlyout(row: HTMLElement, flyout: HTMLElement) {
  const itemRect = row.getBoundingClientRect();
  const width = flyout.offsetWidth, height = flyout.offsetHeight;
  const left = itemRect.right + width > window.innerWidth ? itemRect.left - width : itemRect.right;
  let top = itemRect.top - 6;
  if (top + height > window.innerHeight) top = window.innerHeight - height - 4;
  flyout.style.left = `${Math.max(4, left)}px`;
  flyout.style.top = `${Math.max(4, top)}px`;
}

interface SubmenuControl {
  open: boolean;
  setOpen: (open: boolean) => void;
  onPointer: (event: MouseEvent<HTMLElement>) => void;
  onLeave: (event: MouseEvent<HTMLElement>) => void;
}

export function NodeMenuItems({ entries }: { entries: readonly NodeMenuEntry[] }) {
  const [openId, setOpenIdState] = useState<string | null>(null);
  const openIdRef = useRef<string | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const trail = useRef<Point[]>([]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const setOpenId = (id: string | null) => {
    window.clearTimeout(timer.current);
    openIdRef.current = id;
    setOpenIdState(id);
  };
  // Hover intent: switching away from an open flyout waits while the pointer heads into it
  // or briefly leaves the menu, so diagonal moves and small overshoots keep it open.
  const request = (id: string | null, event: MouseEvent<HTMLElement>, leaving = false) => {
    const point = { x: event.clientX, y: event.clientY };
    trail.current = [...trail.current.slice(-3), point];
    window.clearTimeout(timer.current);
    if (id === openIdRef.current) return;
    if (openIdRef.current === null) { setOpenId(id); return; }
    const flyout = event.currentTarget.parentElement?.querySelector<HTMLElement>(':scope > .is-open > .context-submenu');
    const delay = leaving ? LEAVE_CLOSE_DELAY_MS
      : flyout && isAimingAtFlyout(trail.current[0], point, flyout) ? AIM_SWITCH_DELAY_MS : 0;
    if (delay === 0) setOpenId(id);
    else timer.current = window.setTimeout(() => setOpenId(id), delay);
  };

  return <>{entries.map(entry => entry.kind === 'heading'
    ? <div key={entry.id} className="node-workspace-context-submenu-group"><span>{entry.label}</span></div>
    : entry.kind === 'submenu' ? <NodeMenuSubmenu key={entry.id} entry={entry} control={{
      open: openId === entry.id,
      setOpen: open => setOpenId(open ? entry.id : null),
      onPointer: event => { if (!entry.disabled) request(entry.id, event); },
      onLeave: event => request(null, event, true),
    }} />
      : <button key={entry.id} type="button" role="menuitem" disabled={entry.disabled} title={entry.title}
        onMouseEnter={event => request(null, event)} onMouseMove={event => request(null, event)}
        onClick={event => { blurAfterPointer(event); entry.onSelect(); }}>{entry.label}</button>)}</>;
}

function NodeMenuSubmenu({ entry, control }: { entry: Extract<NodeMenuEntry, { kind: 'submenu' }>; control: SubmenuControl }) {
  const { open, setOpen } = control;
  const rowRef = useRef<HTMLDivElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (open && rowRef.current && flyoutRef.current) positionFlyout(rowRef.current, flyoutRef.current);
  }, [open]);
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
  return <div ref={rowRef} className={`node-workspace-context-submenu is-hover-intent${open ? ' is-open' : ''}`} onKeyDown={onKeyDown}
    onMouseEnter={control.onPointer} onMouseMove={control.onPointer} onMouseLeave={control.onLeave}
    onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button type="button" aria-label={entry.label} aria-haspopup="menu" aria-expanded={open} disabled={entry.disabled} title={entry.title}
      onClick={event => {
        // Touch and pen have no hover: a tap opens the flyout in place.
        blurAfterPointer(event);
        if (!open) setOpen(true);
      }}>{entry.label}{!entry.disabled && <span className="node-workspace-context-count">{countNodeMenuItems(entry.children)}</span>}</button>
    {!entry.disabled && <div ref={flyoutRef} className="node-workspace-context-submenu-list context-submenu" role="menu" aria-label={entry.label}
      style={{ display: open ? 'flex' : 'none' }}>
      <NodeMenuItems entries={entry.children} />
    </div>}
  </div>;
}
