import { useMemo, useState } from 'react';
import { listNodeCatalog } from '../../../../services/operators/operatorCatalog';
import { signalFormatLabel } from '../../../../services/operators/portContracts';
import { NODE_CATEGORIES } from '../../../../services/operators/operatorTaxonomy';
import { EFFECT_GROUPS } from '../../../../effects/effectCatalogGroups';
import { useSettingsStore } from '../../../../stores/settingsStore';
import { NodePortDetails } from '../canvas/NodePortDetails';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import './NodeCatalog.css';

const DOMAINS = ['Image', '3D', 'Splat', 'Audio', 'Flock', 'Clip effects'];
const CATEGORY_ORDER: readonly string[] = [...NODE_CATEGORIES.map(category => category.label), ...EFFECT_GROUPS.map(group => group.label)];
const rank = (category: string) => { const index = CATEGORY_ORDER.indexOf(category); return index < 0 ? CATEGORY_ORDER.length : index; };

export function NodeCatalog({ width }: { width: number }) {
  const entries = useMemo(listNodeCatalog, []);
  const advanced = useSettingsStore(state => state.nodeAdvancedCatalog);
  const setAdvanced = useSettingsStore(state => state.setNodeAdvancedCatalog);
  const [query, setQuery] = useState(''), [domain, setDomain] = useState('');
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filtered = entries.filter(e => (e.visibility === 'public' || (advanced && e.visibility === 'advanced'))
    && (!domain || e.domains.includes(domain))
    && terms.every(term => `${e.id} ${e.label} ${e.description} ${e.category} ${e.tags.join(' ')} ${[...e.inputs, ...e.outputs].map(p => `${p.type} ${p.contract?.formats.map(signalFormatLabel).join(' ')}`).join(' ')}`.toLowerCase().includes(term)));
  const sections = [...new Set(filtered.map(entry => entry.category))].toSorted((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return <aside className="node-workspace-inspector node-catalog" style={{ width, minWidth: width }} aria-label="Node catalog">
    <div className="node-workspace-inspector-header"><h3>Node catalog</h3><p>Nodes, node groups and effects by graph and category.</p></div>
    <input type="search" className="operator-group-name" aria-label="Search node catalog" placeholder="Search names, uses or signal types…" value={query} onChange={e => setQuery(e.target.value)} />
    <InspectorSelect ariaLabel="Node catalog graph" value={domain} options={[{ value: '', label: 'All graphs' }, ...DOMAINS.map(value => ({ value, label: value }))]} onChange={setDomain} />
    <label className="node-catalog-advanced">
      <input type="checkbox" checked={advanced} onChange={event => setAdvanced(event.target.checked)} />
      Advanced nodes and technical details
    </label>
    <p className="face-cable-hint" role="status">{filtered.length} entries</p>
    {sections.map(section => <div key={section} className="node-catalog-section">
      <h4 className="node-catalog-section-title">{section}</h4>
      {filtered.filter(entry => entry.category === section).map(entry => <ResolveInspectorSection key={entry.id} title={entry.label} defaultOpen={false}>
        <p className="face-cable-hint">{entry.description}</p>
        <p className="face-cable-hint">Graphs: {entry.domains.join(', ')}</p>
        <code>{entry.id}</code>
        {advanced && <>
          <ResolveInspectorRow label="Family"><span>{entry.family}</span></ResolveInspectorRow>
          <ResolveInspectorRow label="Execution"><span>{entry.backend} · {entry.fusion}</span></ResolveInspectorRow>
          <ResolveInspectorRow label="State"><span>{entry.state} · {entry.invalidation}</span></ResolveInspectorRow>
          <ResolveInspectorRow label="Consumers"><span>{entry.users.length > 0 ? entry.users.join(', ') : 'unknown'}</span></ResolveInspectorRow>
        </>}
        {entry.sharedOperator && <p className="face-cable-hint">Shared: {entry.sharedOperator}</p>}
        {(['input', 'output'] as const).flatMap(direction => (direction === 'input' ? entry.inputs : entry.outputs).map(p =>
          <div key={`${direction}:${p.id}`} className="node-catalog-port"><NodePortDetails port={{ ...p, direction, metadata: { contract: p.contract, required: p.required, repeated: p.repeated } }} /></div>))}
        {entry.parameters.map(p => <ResolveInspectorRow key={`param:${p.id}`} label={p.label}><span>{String(p.default)}{p.min !== undefined || p.max !== undefined ? ` · ${p.min ?? '−∞'}–${p.max ?? '∞'}` : ''}{p.animatable ? ' · keyframes' : ''}</span></ResolveInspectorRow>)}
      </ResolveInspectorSection>)}
    </div>)}
  </aside>;
}
