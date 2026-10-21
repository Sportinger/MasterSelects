import { useMemo, useRef, useState } from 'react';
import { getDefaultParams } from '../../../effects';
import { effectExperimentalNote, type EffectDefinition } from '../../../effects/types';
import { catalogText } from '../../../services/nodeGraph/catalogText';
import type { LookDefinition } from '../../../effects/looks/types';
import { LookTile } from '../looks/LookTile';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import './EffectCatalogPicker.css';

export interface EffectCatalogGroup {
  /** Display name of the look group. */
  category: string;
  effects: EffectDefinition[];
}

interface EffectCatalogPickerProps {
  groups: EffectCatalogGroup[];
  sourceFrameId: string;
  onSelect: (effectId: string) => void;
}

/**
 * How well an effect's name answers a search: 0 the name itself, 1 a name starting with it,
 * 2 a word of the name starting with it, 3 only the description, tags or category match.
 * Searching "glitch" lists Glitch before the many effects tagged glitch.
 */
function nameMatchRank(name: string, query: string): number {
  const normalizedName = name.toLocaleLowerCase();
  if (normalizedName === query) return 0;
  if (normalizedName.startsWith(query)) return 1;
  return normalizedName.split(/[\s()/-]+/u).some((word) => word.startsWith(query)) ? 2 : 3;
}

export function EffectCatalogPicker({ groups, sourceFrameId, onSelect }: EffectCatalogPickerProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>('all');
  const categories = useMemo(() => groups.map((group) => group.category), [groups]);
  const tiles = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const matches = groups.flatMap((group) => (
      category !== 'all' && group.category !== category
        ? []
        : group.effects
          .filter((effect) => {
            if (!normalizedQuery) return true;
            const text = catalogText(`effect:${effect.id}`);
            return `${effect.name} ${effect.id} ${group.category} ${text.description ?? ''} ${text.tags.join(' ')}${effectExperimentalNote(effect) ? ' experimental' : ''}`.toLocaleLowerCase().includes(normalizedQuery);
          })
          .map((effect) => ({
            effect,
            look: {
              id: `effect-preview-${effect.id}`,
              // Experimental effects say so in the list (their note explains the known artefacts).
              name: effectExperimentalNote(effect) ? `${effect.name} (Experimental)` : effect.name,
              category: 'digital',
              thumbnail: { kind: 'generated' },
              stack: [{ effectId: effect.id, params: getDefaultParams(effect.id), enabled: true }],
              tags: [group.category, effect.id],
              builtIn: true,
            } satisfies LookDefinition,
          }))
    ));
    // Name matches first; otherwise the catalog order stays (the sort is stable).
    return normalizedQuery
      ? matches.toSorted((a, b) => nameMatchRank(a.effect.name, normalizedQuery) - nameMatchRank(b.effect.name, normalizedQuery))
      : matches;
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
          <InspectorSelect
            ariaLabel="Effect category"
            value={category}
            onChange={setCategory}
            options={[{ value: 'all', label: 'All' }, ...categories.map((entry) => ({ value: entry, label: entry }))]}
          />
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
