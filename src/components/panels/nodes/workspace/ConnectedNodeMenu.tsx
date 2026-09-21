import { useEffect, useMemo, useRef, useState } from 'react';
import type { NodeConnectionDrop, NodeGraph } from '../../../../types/nodeGraph';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { connectionNodeCatalog } from '../../../../services/nodeGraph/connectionNodeCatalog';
import { addConnectedNode } from '../../../../services/nodeGraph/addConnectedNode';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import './ConnectedNodeMenu.css';

export function ConnectedNodeMenu({ clip, graph, drop, onClose, onAdded }: {
  clip: TimelineClip; graph: NodeGraph; drop: NodeConnectionDrop; onClose: () => void; onAdded: (id: string) => void;
}) {
  const clips = useTimelineStore(state => state.clips);
  const [query, setQuery] = useState(''), [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null), search = useRef<HTMLInputElement>(null);
  const model = useMemo(() => {
    try { return { catalog: connectionNodeCatalog(clip, graph, drop, clips), error: '' }; }
    catch (error) { return { catalog: undefined, error: error instanceof Error ? error.message : String(error) }; }
  }, [clip, graph, drop, clips]);
  const options = (model.catalog?.options ?? []).filter(option => `${option.label} ${option.category} ${option.port.label} ${option.operatorId ?? ''}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { search.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [onClose]);
  return <div className="node-workspace-context-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}
    onContextMenu={event => event.preventDefault()}>
    <div ref={root} className="node-workspace-context-menu node-connection-menu" role="dialog" aria-label="Add connected node"
      style={{ left: Math.max(8, Math.min(drop.x, window.innerWidth - 328)), top: Math.max(8, Math.min(drop.y, window.innerHeight - 420)) }}
      onPointerUp={event => { if (event.target instanceof Element) event.target.closest<HTMLButtonElement>('button')?.blur(); }}
      onKeyDown={event => {
        event.stopPropagation();
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        event.preventDefault();
        const items = [search.current!, ...root.current!.querySelectorAll<HTMLButtonElement>('button')];
        const index = items.indexOf(document.activeElement as HTMLInputElement), next = (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <strong>{drop.direction === 'output' ? 'Connect to a new node' : 'Connect from a new node'}</strong>
      <input ref={search} aria-label="Search compatible nodes" placeholder="Search nodes…" value={query} onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); root.current?.querySelector<HTMLButtonElement>('button')?.click(); } }} />
      <div className="node-connection-options">
        {options.map((option, index) => <div key={option.id}>
          {option.category !== options[index - 1]?.category && <div className="node-connection-category">{option.category}</div>}
          <button type="button" title={option.description} onClick={() => {
            try { const id = addConnectedNode(model.catalog!, option, clip.id); onAdded(id); onClose(); }
            catch (error) { setError(error instanceof Error ? error.message : String(error)); }
          }}><span>{option.label}</span><small>{option.port.label} · {describeNodePort(option.port).typeLabel}</small></button>
        </div>)}
        {!options.length && <p>No compatible nodes in this graph.</p>}
      </div>
      {(error || model.error) && <p role="alert">{error || model.error}</p>}
    </div>
  </div>;
}
