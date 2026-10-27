// 'filters' sheet: the editor's Looks as filters. One active filter per clip, None, and a Strength
// slider (phoneLookFilters.ts). Picking a filter replaces the clip's previous filter effects with the
// Look's (applyLookToClip, the same stack the desktop builds); everything stays in one cancellable
// session: Done = one undo step, Cancel = exact rollback. With nothing selected the filters stay
// visible but greyed: a Look's effects cannot render on an adjustment layer yet.

import { useMemo, useRef, useState } from 'react';

import { getVisibleLooks, useLookStore } from '../../../effects/looks/lookStore';
import type { LookCategory, LookDefinition } from '../../../effects/looks/types';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PHONE_ADJUSTMENT_SUPPORT_NOTE } from './phoneEffectCatalog';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';
import { readPhoneVisualSelection } from './phoneEffectTargets';
import {
  applyPhoneFilter, detectPhoneFilter, phoneUnscaledEffectNames, removePhoneFilter, setPhoneFilterStrength,
  type PhoneAppliedFilter,
} from './phoneLookFilters';
import { blurPointerButton, PhoneValueSlider } from './PhoneValueSlider';
import './PhoneEffects.css';

const CATEGORIES: ReadonlyArray<{ id: LookCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' }, { id: 'editorial', label: 'Editorial' }, { id: 'print', label: 'Print' },
  { id: 'digital', label: 'Digital' }, { id: 'analog', label: 'Analog' }, { id: 'motion', label: 'Motion' },
  { id: 'custom', label: 'Saved' },
];

const ROOT_REASON = `Select a clip first: a filter changes that clip. Filters combine effects that adjustment layers cannot render yet. ${PHONE_ADJUSTMENT_SUPPORT_NOTE}`;

export const PhoneFiltersSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Filter');
  const customLooks = useLookStore((state) => state.customLooks);
  const [category, setCategory] = useState<LookCategory | 'all'>('all');
  const allLooks = useMemo(() => getVisibleLooks({ customLooks, query: '', category: 'all' }), [customLooks]);
  const looks = useMemo(() => getVisibleLooks({ customLooks, query: '', category }), [customLooks, category]);

  // Selection and the filters found on the clips, captured once when the sheet opens.
  const initial = useRef<{ selection: ReturnType<typeof readPhoneVisualSelection>; filters: Map<string, PhoneAppliedFilter>; strength: number } | null>(null);
  if (!initial.current) {
    const selection = readPhoneVisualSelection({ allowAdjustment: false });
    const filters = new Map<string, PhoneAppliedFilter>();
    let strength = 1;
    for (const clip of selection.clips) {
      const found = detectPhoneFilter(clip.id, clip.effects, allLooks);
      if (!found) continue;
      filters.set(clip.id, found.filter);
      if (clip.id === selection.primary?.id) strength = found.strength;
    }
    initial.current = { selection, filters, strength };
  }
  const { selection } = initial.current;
  const filtersRef = useRef(initial.current.filters);
  const primaryId = selection.primary?.id ?? null;
  const [activeLookId, setActiveLookId] = useState<string | null>(primaryId ? filtersRef.current.get(primaryId)?.lookId ?? null : null);
  const [strength, setStrength] = useState(initial.current.strength);
  const [strengthTouched, setStrengthTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  // Re-render when the store changes so the strength note follows removed effects.
  useTimelineStore((state) => (primaryId ? state.clips.find((clip) => clip.id === primaryId)?.effects.length ?? 0 : 0));

  const blocked = selection.clips.length === 0;
  const blockedReason = selection.nothingSelected ? ROOT_REASON : selection.note ?? 'Select a clip with a picture first.';
  const activeFilter = primaryId ? filtersRef.current.get(primaryId) ?? null : null;
  const unscaled = phoneUnscaledEffectNames(activeFilter);
  const scalable = Boolean(activeFilter?.effects.some((effect) => effect.control));

  const pick = (look: LookDefinition | null) => {
    if (blocked) { showUnavailable({ actionId: 'filters-pick', label: 'Filters', reason: blockedReason }); return; }
    if ((look?.id ?? null) === activeLookId) return;
    setActiveLookId(look?.id ?? null);
    setStrength(1);
    setStrengthTouched(false);
    void session.apply(() => {
      const problems: string[] = [];
      for (const clip of selection.clips) {
        const previous = filtersRef.current.get(clip.id);
        if (previous) removePhoneFilter(previous);
        filtersRef.current.delete(clip.id);
        if (!look) continue;
        const applied = applyPhoneFilter(look, clip.id);
        filtersRef.current.set(clip.id, applied.filter);
        problems.push(...applied.problems);
      }
      if (problems.length) showToast([...new Set(problems)].join(' '), 'error');
    });
  };

  const changeStrength = (value: number) => {
    setStrength(value);
    setStrengthTouched(true);
    void session.apply(() => { for (const filter of filtersRef.current.values()) setPhoneFilterStrength(filter, value); });
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const final = strength;
    const result = await session.commit(strengthTouched
      ? () => { for (const filter of filtersRef.current.values()) setPhoneFilterStrength(filter, final); }
      : undefined);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const activeName = allLooks.find((look) => look.id === activeLookId)?.name;
  const status = blocked
    ? blockedReason
    : `${activeName ? `Filter: ${activeName}` : 'No filter'} · ${selection.primary?.name ?? ''}${selection.clips.length > 1 ? ` and ${selection.clips.length - 1} more` : ''}`;

  return (
    <PhoneSheet title="Filters" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-fx" onPointerUp={blurPointerButton}>
        <p className="phone-fx__target" data-testid={IDS.filtersStatus}>{status}</p>
        {!blocked && selection.note && <p className="phone-fx__note">{selection.note}</p>}
        {activeFilter && (
          <PhoneValueSlider
            label="Strength"
            value={strength}
            min={0}
            max={1}
            step={0.01}
            defaultValue={1}
            format={(value) => `${Math.round(value * 100)}%`}
            onChange={changeStrength}
            disabledReason={scalable ? null : `${activeName ?? 'This filter'} has no mix control, so its strength cannot change. Its effects can be edited in Effects.`}
          />
        )}
        {activeFilter && unscaled.length > 0 && (
          <p className="phone-filters__strength-note" data-testid={IDS.filtersStrengthNote}>
            Strength leaves {unscaled.join(', ')} as {unscaled.length > 1 ? 'they are' : 'it is'}: no mix control.
          </p>
        )}
        <div className="phone-fx__chips" role="group" aria-label="Filter groups">
          {CATEGORIES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="phone-fx__chip"
              aria-pressed={category === entry.id}
              data-testid={IDS.filtersCategory}
              data-group={entry.id}
              onClick={() => setCategory(entry.id)}
            >
              {entry.label}
            </button>
          ))}
        </div>
        <div className="phone-fx__grid">
          <button
            type="button"
            className="phone-fx__card"
            aria-pressed={activeLookId === null}
            aria-disabled={blocked}
            data-testid={IDS.filtersNone}
            onClick={() => pick(null)}
          >
            <span className="phone-fx__card-badge" aria-hidden="true">∅</span>
            <span className="phone-fx__card-name">None</span>
          </button>
          {looks.map((look) => (
            <button
              key={look.id}
              type="button"
              className="phone-fx__card"
              aria-pressed={activeLookId === look.id}
              aria-disabled={blocked}
              data-testid={IDS.filtersCard}
              data-look-id={look.id}
              onClick={() => pick(look)}
            >
              <span className="phone-fx__card-badge" aria-hidden="true">{look.name.slice(0, 2)}</span>
              <span className="phone-fx__card-name">{look.name}</span>
            </button>
          ))}
          {looks.length === 0 && <p className="phone-fx__note">No saved filters yet. Save an effect stack as a Look in the full editor.</p>}
        </div>
      </div>
    </PhoneSheet>
  );
};
