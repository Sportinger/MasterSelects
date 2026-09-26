import { Fragment, useRef, useState, type ReactNode } from 'react';
import { EffectAddSection } from './EffectAddSection';
import { InspectorSelect } from '../../inspector/InspectorSelect';

type CatalogEntry = { id: string; name: string; category?: string; description?: string; tags?: readonly string[] };

/** Searchable, categorized tile browser for the audio effect picker. */
export function EffectCatalogBrowser<T extends CatalogEntry>({ entries, title, onSelect, renderTile, categoryLabels }: {
  entries: readonly T[];
  /** Display names in menu order; categories without a name keep their id. */
  categoryLabels?: Readonly<Record<string, string>>;
  title?: string;
  onSelect: (id: string) => void;
  renderTile: (entry: T, apply: () => void) => ReactNode;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const order = Object.keys(categoryLabels ?? {});
  const categories = [...new Set(entries.map(entry => entry.category ?? 'Other'))]
    .toSorted((a, b) => (order.indexOf(a) + 1 || order.length + 1) - (order.indexOf(b) + 1 || order.length + 1));
  const visible = entries.filter(entry => (category === 'all' || (entry.category ?? 'Other') === category)
    && `${entry.name} ${entry.id} ${entry.description ?? ''} ${(entry.tags ?? []).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <EffectAddSection title={title} detailsRef={detailsRef}>
    <div className="effect-catalog-tools">
      <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search effects" aria-label="Search effects" />
      <InspectorSelect ariaLabel="Effect category" value={category} onChange={setCategory}
        options={[{ value: 'all', label: 'All' }, ...categories.map(value => ({ value, label: categoryLabels?.[value] ?? value }))]} />
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
