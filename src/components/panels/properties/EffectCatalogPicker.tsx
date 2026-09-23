import { useMemo, useRef, useState } from 'react';
import { getDefaultParams } from '../../../effects';
import type { EffectCategory, EffectDefinition } from '../../../effects/types';
import type { LookDefinition } from '../../../effects/looks/types';
import { LookTile } from '../looks/LookTile';
import './EffectCatalogPicker.css';

export interface EffectCatalogGroup {
  category: EffectCategory;
  effects: EffectDefinition[];
}

interface EffectCatalogPickerProps {
  groups: EffectCatalogGroup[];
  sourceFrameId: string;
  onSelect: (effectId: string) => void;
}

export function EffectCatalogPicker({ groups, sourceFrameId, onSelect }: EffectCatalogPickerProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<EffectCategory | 'all'>('all');
  const categories = useMemo(() => groups.map((group) => group.category), [groups]);
  const tiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return groups.flatMap((group) => (
      category !== 'all' && group.category !== category
        ? []
        : group.effects
          .filter((effect) => !normalizedQuery || `${effect.name} ${effect.id}`.toLocaleLowerCase().includes(normalizedQuery))
          .map((effect) => ({
            effect,
            look: {
              id: `effect-preview-${effect.id}`,
              name: effect.name,
              category: 'digital',
              thumbnail: { kind: 'generated' },
              stack: [{ effectId: effect.id, params: getDefaultParams(effect.id), enabled: true }],
              tags: [effect.category, effect.id],
              builtIn: true,
            } satisfies LookDefinition,
          }))
    ));
  }, [category, groups, query]);

  const select = (effectId: string) => {
    onSelect(effectId);
    if (detailsRef.current) detailsRef.current.open = false;
  };

  return (
    <details className="effect-catalog-picker" ref={detailsRef} onToggle={event => {
      if (event.currentTarget.open) event.currentTarget.querySelector<HTMLInputElement>('input[aria-label="Search effects"]')?.focus();
    }}>
      <summary>+ Add Effect</summary>
      <div className="effect-catalog-picker-body">
        <div className="effect-catalog-tools">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search effects"
            aria-label="Search effects"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value as EffectCategory | 'all')}
            aria-label="Effect category"
          >
            <option value="all">All</option>
            {categories.map((entry) => <option value={entry} key={entry}>{entry}</option>)}
          </select>
        </div>
        <div className="effect-catalog-grid">
          {tiles.map(({ effect, look }) => (
            <LookTile
              key={effect.id}
              look={look}
              sourceFrameId={sourceFrameId}
              onApply={() => select(effect.id)}
            />
          ))}
        </div>
        {tiles.length === 0 && <p className="effect-catalog-empty">No matching effects.</p>}
      </div>
    </details>
  );
}
