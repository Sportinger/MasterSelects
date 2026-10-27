// 'animation' sheet: In / Out / Combo presets for the selected video, image or title clips with a
// duration slider, plus a character Reveal for titles. The editor has no preset model, so every
// preset is written as ordinary transform/opacity keyframes (text.reveal for Reveal) through the
// editor's keyframe actions (phoneAnimationWrite.ts). Changes show live inside one owned
// transaction: Done = one undo step, Cancel = exact rollback. Reopening the sheet recognises a
// preset the clip already has.

import { useMemo, useRef, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneMotionGlyph } from '../crop/phoneChoiceGlyphs';
import { blurAfterPointer, PhoneChip, PhoneSliderRow, PhoneSwitchRow } from '../text/phoneControls';
import { PhoneChipRow } from '../transition/phoneSheetPrimitives';
import {
  PHONE_ANIMATION_DEFAULT_DURATION, PHONE_ANIMATION_MIN_DURATION, PHONE_COMBO_PRESETS, PHONE_IN_PRESETS,
  PHONE_OUT_PRESETS, PHONE_REVEAL_MODES, type PhoneAnimationChoice, type PhoneAnimationPart, type PhoneRevealMode,
} from './phoneAnimationPresets';
import { PHONE_ANIMATION_TABS, PHONE_ANIMATION_TEST_IDS as IDS, phoneAnimationPresetTestId, type PhoneAnimationTab } from './phoneAnimationTestIds';
import { capturePhoneAnimationTargets, planForTarget, writePhoneAnimation } from './phoneAnimationWrite';
import './PhoneAnimation.css';

const TAB_LABELS: Record<PhoneAnimationTab, string> = { in: 'In', out: 'Out', combo: 'Combo', reveal: 'Reveal' };
const REVEAL_REASON = 'Reveal builds a title character by character, so it needs a text clip. Select a title to use it.';

function initialTab(choice: PhoneAnimationChoice): PhoneAnimationTab {
  if (choice.combo) return 'combo';
  if (!choice.in && choice.out) return 'out';
  if (!choice.in && !choice.out && choice.reveal) return 'reveal';
  return 'in';
}

/** A preset as a tile: a motion pictogram above its name. */
function PresetTile({ id, label, selected, testId, onSelect }: { id: string; label: string; selected: boolean; testId: string; onSelect: () => void }) {
  return (
    <PhoneChip className="phone-design-chip--tile" ariaLabel={label} selected={selected} testId={testId} onSelect={onSelect}
      label={<><span className="phone-design-chip__picture" aria-hidden="true"><PhoneMotionGlyph id={id} /></span><span>{label}</span></>} />
  );
}

export const PhoneAnimationSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Animation');
  const [{ targets, skipped }] = useState(capturePhoneAnimationTargets);
  const primary = targets[0];
  // The Reveal part starts from the first title (the primary may be a video in a mixed selection).
  const [choice, setChoice] = useState<PhoneAnimationChoice>(() => (primary
    ? { ...primary.recognized, reveal: targets.find((target) => target.isText)?.recognized.reveal ?? null }
    : { in: null, out: null, combo: null, reveal: null }));
  const [tab, setTab] = useState<PhoneAnimationTab>(() => initialTab(choice));
  /** Parts the user changed: only these are written to the other selected clips. */
  const [touched, setTouched] = useState<ReadonlySet<PhoneAnimationPart>>(() => new Set());
  const touchedRef = useRef(touched); // two changes before a re-render must not lose a part
  const [busy, setBusy] = useState(false);
  const anyText = targets.some((target) => target.isText);
  const firstText = targets.find((target) => target.isText);
  const plan = useMemo(() => (primary ? planForTarget(primary, choice, touched) : null), [primary, choice, touched]);
  // A mixed selection whose primary is not a title shows the Reveal of the first title it writes to.
  const revealPlan = useMemo(() => (firstText ? planForTarget(firstText, choice, touched) : null), [firstText, choice, touched]);

  const update = (next: PhoneAnimationChoice, parts: readonly PhoneAnimationPart[]) => {
    const nextTouched = new Set([...touchedRef.current, ...parts]);
    touchedRef.current = nextTouched;
    setChoice(next);
    setTouched(nextTouched);
    void session.apply(() => writePhoneAnimation(targets, next, nextTouched));
  };

  const done = async () => {
    if (busy) return;
    if (touched.size === 0) { session.cancel(); closeSheet(); return; }
    setBusy(true);
    const result = await session.commit(() => writePhoneAnimation(targets, choice, touched));
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };
  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  if (!primary) {
    return (
      <PhoneSheet title="Animation" onCancel={cancel} cancelLabel="Close">
        <p className="phone-sheet__note" data-testid={IDS.empty}>
          {skipped.length > 0 ? `This clip cannot be animated here: ${skipped[0].reason}.` : 'Select a video, image or title clip to animate it.'}
        </p>
      </PhoneSheet>
    );
  }

  const shown = plan?.choice ?? choice;
  const sideDuration = (side: 'in' | 'out') => shown[side]?.duration ?? Math.min(PHONE_ANIMATION_DEFAULT_DURATION, primary.clipDuration / 2);
  const comboDuration = shown.in?.duration ?? Math.min(PHONE_ANIMATION_DEFAULT_DURATION, primary.clipDuration / 2);
  const max = Math.max(PHONE_ANIMATION_MIN_DURATION, Number(primary.clipDuration.toFixed(2)));

  const pickSide = (side: 'in' | 'out', preset: string) => {
    const other = side === 'in' ? 'out' : 'in';
    const next: PhoneAnimationChoice = {
      ...choice,
      combo: null,
      // A combo owns both sides: leaving it for one side drops its other half too.
      [other]: choice.combo ? null : choice[other],
      [side]: preset === 'none' ? null : { preset, duration: choice.combo ? sideDuration(side) : choice[side]?.duration ?? sideDuration(side) },
    };
    update(next, choice.combo ? ['in', 'out'] : [side]);
  };
  const pickCombo = (id: string) => {
    const combo = PHONE_COMBO_PRESETS.find((candidate) => candidate.id === id);
    if (!combo) { update({ ...choice, combo: null, in: null, out: null }, ['in', 'out']); return; }
    const duration = choice.combo ? comboDuration : Math.min(PHONE_ANIMATION_DEFAULT_DURATION, primary.clipDuration / 2);
    update({ ...choice, combo: id, in: { preset: combo.in, duration }, out: { preset: combo.out, duration } }, ['in', 'out']);
  };
  const revealClipDuration = firstText?.clipDuration ?? primary.clipDuration;
  const revealDuration = revealPlan?.choice.reveal?.duration ?? choice.reveal?.duration ?? Math.min(1, revealClipDuration);
  const pickReveal = (mode: PhoneRevealMode | 'none') => {
    update({ ...choice, reveal: mode === 'none' ? null : { mode, duration: choice.reveal?.duration ?? Math.min(1, revealClipDuration), cursor: choice.reveal?.cursor ?? false } }, ['reveal']);
  };

  const onTab = (next: PhoneAnimationTab) => {
    if (next === 'reveal' && !anyText) { showUnavailable({ actionId: 'animation-reveal', label: 'Reveal', reason: REVEAL_REASON }); return; }
    setTab(next);
  };

  const presetChips = (side: 'in' | 'out') => {
    const presets = side === 'in' ? PHONE_IN_PRESETS : PHONE_OUT_PRESETS;
    const active = choice.combo ? null : choice[side]?.preset ?? 'none';
    return (
      <div className="phone-animation-sheet__grid" role="group" aria-label={`${TAB_LABELS[side]} animation`}>
        <PresetTile id="none" label="None" selected={active === 'none'} testId={phoneAnimationPresetTestId(side, 'none')} onSelect={() => pickSide(side, 'none')} />
        {presets.map((preset) => (
          <PresetTile key={preset.id} id={preset.id} label={preset.label} selected={active === preset.id}
            testId={phoneAnimationPresetTestId(side, preset.id)} onSelect={() => pickSide(side, preset.id)} />
        ))}
      </div>
    );
  };

  const durationRow = (value: number, rowMax: number, onChange: (value: number) => void, enabled: boolean) => (
    <PhoneSliderRow label="Duration" value={value} min={PHONE_ANIMATION_MIN_DURATION} max={rowMax} step={0.05}
      format={(seconds) => `${seconds.toFixed(2)} s`} testId={IDS.duration} disabled={!enabled} onChange={onChange} />
  );

  const notes: string[] = [];
  if (plan?.clamped) notes.push('Shortened to fit the clip: In and Out together cannot be longer than the clip.');
  if (plan && plan.replaced > 0 && touched.size > 0) notes.push(`Replaces ${plan.replaced} existing keyframe${plan.replaced === 1 ? '' : 's'} in the animated range.`);
  if (skipped.length > 0) notes.push(`${skipped.length} selected clip${skipped.length === 1 ? '' : 's'} skipped: ${skipped[0].reason}.`);
  if (targets.length > 1) notes.push(`Applies to ${targets.length} selected clips.`);
  if (tab === 'reveal' && targets.some((target) => !target.isText)) notes.push('Reveal applies to the selected titles only.');

  return (
    <PhoneSheet title="Animation" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-animation-sheet">
        <PhoneChipRow role="tablist" label="Animation type" className="phone-design-tabs">
          {PHONE_ANIMATION_TABS.map((id) => (
            <button key={id} type="button" role="tab" className="phone-design-tab" aria-selected={tab === id}
              aria-disabled={id === 'reveal' && !anyText ? 'true' : undefined}
              data-testid={`${IDS.tab}-${id}`} onPointerUp={blurAfterPointer} onClick={() => onTab(id)}>
              {TAB_LABELS[id]}
            </button>
          ))}
        </PhoneChipRow>

        {tab === 'in' && (<>{presetChips('in')}{durationRow(sideDuration('in'), max, (duration) => choice.in && update({ ...choice, in: { ...choice.in, duration } }, ['in']), !!choice.in && !choice.combo)}</>)}
        {tab === 'out' && (<>{presetChips('out')}{durationRow(sideDuration('out'), max, (duration) => choice.out && update({ ...choice, out: { ...choice.out, duration } }, ['out']), !!choice.out && !choice.combo)}</>)}
        {tab === 'combo' && (
          <>
            <div className="phone-animation-sheet__grid" role="group" aria-label="Combo animation">
              <PresetTile id="none" label="None" selected={!choice.combo} testId={phoneAnimationPresetTestId('combo', 'none')} onSelect={() => pickCombo('none')} />
              {PHONE_COMBO_PRESETS.map((combo) => (
                <PresetTile key={combo.id} id={combo.id} label={combo.label} selected={choice.combo === combo.id}
                  testId={phoneAnimationPresetTestId('combo', combo.id)} onSelect={() => pickCombo(combo.id)} />
              ))}
            </div>
            {durationRow(comboDuration, Math.max(PHONE_ANIMATION_MIN_DURATION, Number((primary.clipDuration / 2).toFixed(2))), (duration) => {
              if (choice.combo && choice.in && choice.out) update({ ...choice, in: { ...choice.in, duration }, out: { ...choice.out, duration } }, ['in', 'out']);
            }, !!choice.combo)}
          </>
        )}
        {tab === 'reveal' && (
          <>
            <div className="phone-animation-sheet__grid" role="group" aria-label="Reveal">
              <PresetTile id="none" label="None" selected={!choice.reveal} testId={phoneAnimationPresetTestId('reveal', 'none')} onSelect={() => pickReveal('none')} />
              {PHONE_REVEAL_MODES.map((mode) => (
                <PresetTile key={mode.id} id={mode.id} label={mode.label} selected={choice.reveal?.mode === mode.id}
                  testId={phoneAnimationPresetTestId('reveal', mode.id)} onSelect={() => pickReveal(mode.id)} />
              ))}
            </div>
            {durationRow(revealDuration, Math.max(PHONE_ANIMATION_MIN_DURATION, Number(revealClipDuration.toFixed(2))),
              (duration) => choice.reveal && update({ ...choice, reveal: { ...choice.reveal, duration } }, ['reveal']), !!choice.reveal)}
            <PhoneSwitchRow label="Block cursor" checked={choice.reveal?.cursor ?? false} testId={IDS.revealCursor}
              onChange={(cursor) => { if (choice.reveal) update({ ...choice, reveal: { ...choice.reveal, cursor } }, ['reveal']); else showToast('Pick a reveal first.'); }} />
          </>
        )}

        <p className="phone-design-note">Presets are keyframes on position, scale, rotation and opacity; they open unchanged in the full editor.</p>
        {notes.map((note) => <p key={note} className="phone-design-note phone-design-note--warn" data-testid={IDS.note}>{note}</p>)}
      </div>
    </PhoneSheet>
  );
};
