import { Fragment, useRef, useState, type ReactNode } from 'react';
import { EffectAddSection } from './EffectAddSection';
import { InspectorSelect } from '../../inspector/InspectorSelect';

type CatalogEntry = { id: string; name: string; category?: string };

/** Searchable, categorized tile browser for the audio effect picker. */
export function EffectCatalogBrowser<T extends CatalogEntry>({ entries, title, onSelect, renderTile }: {
  entries: readonly T[];
  title?: string;
  onSelect: (id: string) => void;
  renderTile: (entry: T, apply: () => void) => ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const categories = [...new Set(entries.map(entry => entry.category ?? 'Other'))];
  const visible = entries.filter(entry => (category === 'all' || (entry.category ?? 'Other') === category)
    && `${entry.name} ${entry.id}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <EffectAddSection title={title} detailsRef={detailsRef}>
    <div className="effect-catalog-tools">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search effects" aria-label="Search effects" />
      <InspectorSelect ariaLabel="Effect category" value={category} onChange={setCategory}
        options={[{ value: 'all', label: 'All' }, ...categories.map(value => ({ value, label: value }))]} />
    </div>
    <div className="effect-catalog-grid">
      {visible.map(entry => <Fragment key={entry.id}>{renderTile(entry, () => {
        onSelect(entry.id);
        if (detailsRef.current) detailsRef.current.open = false;
      })}</Fragment>)}
    </div>
    {visible.length === 0 && <p className="effect-catalog-empty">No matching effects.</p>}
  </EffectAddSection>;
}
