import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { exposeParameterSourceInputs, resetParameterSourceInputs } from '../../../../services/parameterSources/parameterSourceActions';
import { NODE_WIDTH } from './canvasGeometry';

export function NodeControlInputPicker({ clipId, node }: { clipId?: string; node: NodeGraphNode }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const available = useMemo(() => (node.controlInputs ?? []).filter(input => !input.visible), [node.controlInputs]);
  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return needle ? available.filter(input => `${input.label} ${input.group}`.toLocaleLowerCase().includes(needle)) : available;
  }, [available, query]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  useEffect(() => { if (open) searchRef.current?.focus(); }, [open]);
  if (!clipId || !(node.controlInputs?.length)) return null;

  const stopPointer = (event: ReactPointerEvent) => event.stopPropagation();
  const expose = (properties: readonly string[]) => {
    exposeParameterSourceInputs(clipId, properties);
    setQuery('');
    setOpen(false);
  };

  return <div ref={rootRef} className="node-control-input-picker"
    style={{ left: node.layout.x + NODE_WIDTH + 5, top: node.layout.y + 5 }} onPointerDown={stopPointer}>
    <button type="button" className="node-control-input-add" aria-label={`Add input to ${node.label}`}
      aria-haspopup="dialog" aria-expanded={open} title={available.length ? 'Add or reset inputs' : 'Reset inputs'}
      onPointerDown={stopPointer} onClick={event => { event.stopPropagation(); setOpen(value => !value); }}>
      +
    </button>
    {open && <div className="node-control-input-menu" role="dialog" aria-label={`Inputs for ${node.label}`}
      onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); } }}>
      <div className="node-control-input-menu-head">
        <input ref={searchRef} type="search" value={query} placeholder="Search inputs" aria-label="Search inputs"
          onChange={event => setQuery(event.currentTarget.value)} onPointerDown={stopPointer} />
        <button type="button" disabled={!available.length} onPointerDown={stopPointer}
          onClick={() => expose(available.map(input => input.property))}>All</button>
        <button type="button" onPointerDown={stopPointer}
          onClick={() => { resetParameterSourceInputs(clipId, node.controlInputs!.map(input => input.property)); setQuery(''); setOpen(false); }}>Reset</button>
      </div>
      <div className="node-control-input-options">
        {filtered.map(input => <button type="button" key={input.property} title={input.group}
          onPointerDown={stopPointer} onClick={() => expose([input.property])}>
          <span>{input.label}</span><small>{input.group}</small>
        </button>)}
        {!filtered.length && <span className="node-control-input-empty">No matching inputs</span>}
      </div>
    </div>}
  </div>;
}
