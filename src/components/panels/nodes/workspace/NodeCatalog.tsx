import { useMemo, useState } from 'react';
import { listNodeCatalog } from '../../../../services/operators/operatorCatalog';
import { signalFormatLabel } from '../../../../services/operators/portContracts';
import { NodePortDetails } from '../canvas/NodePortDetails';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import './NodeCatalog.css';

export function NodeCatalog({ width }: { width: number }) {
  const entries = useMemo(listNodeCatalog, []);
  const [query, setQuery] = useState(''), [context, setContext] = useState('');
  const filtered = entries.filter(e => (!context || e.context === context)
    && `${e.id} ${e.label} ${e.description} ${[...e.inputs, ...e.outputs].map(p => `${p.type} ${p.contract?.formats.map(signalFormatLabel).join(' ')} ${p.contract?.constraints?.join(' ')}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()));
  return <aside className="node-workspace-inspector node-catalog" style={{ width, minWidth: width }} aria-label="Node catalog">
    <div className="node-workspace-inspector-header"><h3>Node catalog</h3><p>Available building blocks, their connections and supported uses.</p></div>
    <input type="search" className="operator-group-name" aria-label="Search node catalog" placeholder="Search names or signal types…" value={query} onChange={e => setQuery(e.target.value)} />
    <InspectorSelect ariaLabel="Node catalog context" value={context} options={[{ value: '', label: 'All contexts' }, ...[...new Set(entries.map(e => e.context))].map(value => ({ value, label: value }))]} onChange={setContext} />
    <p className="face-cable-hint" role="status">{filtered.length} nodes</p>
    {filtered.map(entry => <ResolveInspectorSection key={entry.id} title={entry.label} defaultOpen={false}>
      <p className="face-cable-hint">{entry.description}</p>
      <p className="face-cable-hint">Used in: {entry.context}</p>
      <code>{entry.id}</code>
      {entry.sharedOperator && <p className="face-cable-hint">Shared: {entry.sharedOperator}</p>}
      {(['input', 'output'] as const).flatMap(direction => (direction === 'input' ? entry.inputs : entry.outputs).map(p =>
        <div key={`${direction}:${p.id}`} className="node-catalog-port"><NodePortDetails port={{ ...p, direction, metadata: { contract: p.contract, required: p.required, repeated: p.repeated } }} /></div>))}
      {entry.parameters.map(p => <ResolveInspectorRow key={`param:${p.id}`} label={p.label}><span>{String(p.default)}{p.animatable ? ' · keyframes' : ''}</span></ResolveInspectorRow>)}
    </ResolveInspectorSection>)}
  </aside>;
}
