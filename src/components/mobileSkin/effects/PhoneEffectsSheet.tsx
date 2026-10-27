// 'effects' sheet: the editor's whole effect catalog by group (search, chips, cards), tap a card to
// add it to the selected clips; the applied stack of the primary clip with on/off, move and remove;
// one main slider for the focused effect. With nothing selected the first effect adds an adjustment
// layer at the playhead (only the effects the editor renders on adjustment layers are offered there).
// Live changes stay in one cancellable session: Done = one undo step, Cancel = exact rollback.

import { useMemo, useState } from 'react';

import { effectExperimentalNote, getEffect, getEffectDisplayName } from '../../../effects';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { openPhoneClipboard } from '../clipboard/phoneClipboardCommands';
import { PhoneProRow } from '../panels/PhoneProRows';
import { PhoneEffectStack } from './PhoneEffectStack';
import { PhoneLookSaveRow } from './PhoneLookSaveRow';
import {
  filterPhoneEffects, PHONE_ADJUSTMENT_SUPPORT_NOTE, phoneEffectAvailability, phoneEffectGroups,
} from './phoneEffectCatalog';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';
import { isAdjustmentClip, PHONE_ADJUSTMENT_DURATION } from './phoneEffectTargets';
import { blurPointerButton } from './PhoneValueSlider';
import { phoneVisibleEffects, usePhoneEffectsCommands } from './usePhoneEffectsCommands';
import './PhoneEffects.css';

export const PhoneEffectsSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const commands = usePhoneEffectsCommands();
  const { selection } = commands;
  const [targetId, setTargetId] = useState<string | null>(commands.targetClipId());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [groupId, setGroupId] = useState('all');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const clip = useTimelineStore((state) => (targetId ? state.clips.find((candidate) => candidate.id === targetId) ?? null : null));
  const groups = useMemo(() => phoneEffectGroups(), []);
  const cards = useMemo(() => filterPhoneEffects(groups, groupId, query), [groups, groupId, query]);
  const stack = phoneVisibleEffects(clip?.effects);
  const focused = stack.find((effect) => effect.id === focusedId) ?? stack.at(-1) ?? null;
  // Any adjustment layer among the targets limits the catalog to what adjustment layers render.
  const adjustment = selection.nothingSelected || isAdjustmentClip(clip) || selection.clips.some(isAdjustmentClip);
  const blocked = !selection.nothingSelected && selection.clips.length === 0;

  const add = async (effectType: string) => {
    if (blocked) {
      showUnavailable({ actionId: 'effects-add', label: 'Effects', reason: selection.note ?? 'Select a clip with a picture first.' });
      return;
    }
    const availability = phoneEffectAvailability(effectType, adjustment ? 'adjustment' : 'clip');
    if (availability.kind === 'unavailable') {
      showUnavailable({ actionId: `effects-card-${effectType}`, label: getEffect(effectType)?.name ?? effectType, reason: availability.reason });
      return;
    }
    const id = await commands.add(effectType);
    setTargetId(commands.targetClipId());
    if (id) setFocusedId(id);
    else showToast(`${getEffect(effectType)?.name ?? effectType} could not be added.`, 'error');
    const note = effectExperimentalNote(getEffect(effectType));
    if (id && note) showToast(`${getEffect(effectType)!.name} is experimental: ${note}`, 'info');
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const result = await commands.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    commands.cancel();
    closeSheet();
  };

  // Copy or paste effects: keep this sheet's changes (one undo step), then open Copy & paste on effects.
  const openClipboard = async () => {
    if (busy) return;
    setBusy(true);
    const result = await commands.commit();
    if (!result.ok) { closeSheet(); showToast(result.message, 'error'); return; }
    openPhoneClipboard('effects');
  };

  const targetText = blocked
    ? selection.note
    : clip
      ? `${isAdjustmentClip(clip) ? 'Adjustment layer' : clip.name}${selection.clips.length > 1 ? ` · new effects go to all ${selection.clips.length} selected clips` : ''}`
      : `Nothing selected: the first effect adds an adjustment layer at the playhead (${PHONE_ADJUSTMENT_DURATION} s) that changes everything below it.`;

  return (
    <PhoneSheet title="Effects" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-fx" onPointerUp={blurPointerButton}>
        <p className="phone-fx__target" data-testid={IDS.effectsTarget}>{targetText}</p>
        {!blocked && selection.note && <p className="phone-fx__note">{selection.note}</p>}

        {clip && (
          <PhoneEffectStack
            clip={clip}
            stack={stack}
            focused={focused}
            onFocus={setFocusedId}
            commands={commands}
          />
        )}
        {clip && <PhoneLookSaveRow clip={clip} />}
        <PhoneProRow
          label="Copy or paste effects"
          detail="With their animation, onto several clips"
          testId={IDS.effectsClipboard}
          onOpen={() => { void openClipboard(); }}
        />

        <section className="phone-fx__browser" aria-label="Add an effect">
          <input
            className="phone-fx__search"
            type="search"
            inputMode="search"
            placeholder="Search effects"
            aria-label="Search effects"
            data-testid={IDS.effectsSearch}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="phone-fx__chips" role="group" aria-label="Effect groups">
            {[{ id: 'all', label: 'All' }, ...groups].map((group) => (
              <button
                key={group.id}
                type="button"
                className="phone-fx__chip"
                aria-pressed={groupId === group.id}
                data-testid={IDS.effectsCategory}
                data-group={group.id}
                onClick={() => setGroupId(group.id)}
              >
                {group.label}
              </button>
            ))}
          </div>
          {adjustment && <p className="phone-fx__note">{PHONE_ADJUSTMENT_SUPPORT_NOTE}</p>}
          <div className="phone-fx__grid">
            {cards.map((effect) => {
              const unavailable = blocked || phoneEffectAvailability(effect.id, adjustment ? 'adjustment' : 'clip').kind === 'unavailable';
              return (
                <button
                  key={effect.id}
                  type="button"
                  className="phone-fx__card"
                  aria-disabled={unavailable}
                  data-testid={IDS.effectsCard}
                  data-effect-type={effect.id}
                  onClick={() => { void add(effect.id); }}
                >
                  <span className="phone-fx__card-badge" aria-hidden="true">{effect.name.slice(0, 2)}</span>
                  <span className="phone-fx__card-name">{getEffectDisplayName({ name: effect.name, type: effect.id })}</span>
                  {effectExperimentalNote(effect) && <span className="phone-fx__card-tag">Experimental</span>}
                </button>
              );
            })}
            {cards.length === 0 && <p className="phone-fx__note">No effect matches “{query}”.</p>}
          </div>
        </section>
      </div>
    </PhoneSheet>
  );
};
