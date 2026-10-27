// Applied effects of the target clip in render order: tap a row to focus its main slider, switch it
// on/off, move it up/down or remove it. "All parameters" keeps what this sheet did (one undo step)
// and opens the desktop Properties panel on the clip's Effects tab: every parameter, preset and keyframe.

import { getEffect, getEffectDisplayName } from '../../../effects';
import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import type { Effect } from '../../../types/effects';
import type { TimelineClip } from '../../../types/timeline';
import { PHONE_FULL_EDITOR_HINT } from '../contracts';
import { PhoneIcon } from '../shell/phoneIcons';
import { openPhoneProperties } from '../panels/phonePanelNavigation';
import { PhoneProRow } from '../panels/PhoneProRows';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { formatPhoneParamValue, phoneParamRange, phonePrimaryParam } from './phoneEffectCatalog';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';
import { PhoneValueSlider } from './PhoneValueSlider';
import type { PhoneEffectsCommands } from './usePhoneEffectsCommands';


interface PhoneEffectStackProps {
  clip: TimelineClip;
  stack: readonly Effect[];
  focused: Effect | null;
  onFocus: (effectId: string) => void;
  commands: PhoneEffectsCommands;
}

/** The value a parameter renders at the playhead (keyframes included), else its stored value. */
function useRenderedParam(clip: TimelineClip, effect: Effect, name: string): number {
  return useTimelineStore((state) => {
    const local = state.playheadPosition - clip.startTime;
    let value: unknown;
    try {
      value = state.getInterpolatedEffects(clip.id, local).find((candidate) => candidate.id === effect.id)?.params[name];
    } catch {
      value = undefined;
    }
    if (typeof value !== 'number') value = effect.params[name];
    if (typeof value !== 'number') value = getEffect(effect.type)?.params[name]?.default;
    return typeof value === 'number' ? value : 0;
  });
}

function PrimarySlider({ clip, effect, commands }: { clip: TimelineClip; effect: Effect; commands: PhoneEffectsCommands }) {
  const primary = phonePrimaryParam(effect.type);
  const value = useRenderedParam(clip, effect, primary?.name ?? '');
  const keyframed = useTimelineStore((state) => Boolean(primary && (state.clipKeyframes.get(clip.id) ?? [])
    .some((keyframe) => keyframe.property === createEffectProperty(effect.id, primary.name))));
  if (!primary) {
    return <p className="phone-fx__note">{getEffectDisplayName(effect)} has no main slider: it is on or off here. Its settings are under All parameters.</p>;
  }
  const { min, max, step } = phoneParamRange(primary.param);
  const driven = isParameterNodeDriven(clip, createEffectProperty(effect.id, primary.name));
  const defaultValue = typeof primary.param.default === 'number' ? primary.param.default : min;
  return (
    <PhoneValueSlider
      label={`${getEffectDisplayName(effect)} · ${primary.param.label}`}
      value={value}
      min={min}
      max={max}
      step={step}
      defaultValue={defaultValue}
      format={(next) => formatPhoneParamValue(primary.param, next)}
      onChange={(next) => { void commands.setParam(effect.id, primary.name, next); }}
      disabledReason={driven ? `${primary.param.label} is driven by a node, so it cannot be set here. ${PHONE_FULL_EDITOR_HINT}` : null}
      note={keyframed ? 'Keyframed: a change sets a key at the playhead.' : value < min || value > max ? `The value lies outside the slider (${min} to ${max}); moving it brings it back in.` : null}
    />
  );
}

export function PhoneEffectStack({ clip, stack, focused, onFocus, commands }: PhoneEffectStackProps) {
  const showToast = usePhoneUiStore((state) => state.showToast);
  // Keep what the sheet changed as one undo step, then show every parameter in the desktop inspector.
  const openAllParameters = async () => {
    const result = await commands.commit();
    if (!result.ok) { showToast(result.message, 'error'); return; }
    const opened = openPhoneProperties({ kind: 'clip', clipId: clip.id, tab: 'effects' });
    if (!opened.ok) showToast(opened.message, 'error');
  };
  if (stack.length === 0) {
    return <p className="phone-fx__note" data-testid={IDS.effectsEmpty}>No effects yet. Tap one below to add it.</p>;
  }
  return (
    <section className="phone-fx__stack" aria-label="Applied effects">
      <ul className="phone-fx__rows">
        {stack.map((effect, index) => (
          <li
            key={effect.id}
            className="phone-fx__row"
            data-testid={IDS.effectsStackRow}
            data-effect-id={effect.id}
            data-effect-type={effect.type}
            aria-selected={focused?.id === effect.id}
            data-enabled={effect.enabled !== false}
          >
            <button type="button" className="phone-fx__row-name" onClick={() => onFocus(effect.id)}>
              {getEffectDisplayName(effect)}
            </button>
            <button
              type="button"
              className="phone-fx__switch"
              role="switch"
              aria-checked={effect.enabled !== false}
              aria-label={`${getEffectDisplayName(effect)} on`}
              data-testid={IDS.effectsToggle}
              onClick={() => { void commands.setEnabled(effect.id, effect.enabled === false); }}
            >
              <span className="phone-fx__switch-knob" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="phone-fx__icon-button"
              aria-label="Move up"
              aria-disabled={index === 0}
              data-testid={IDS.effectsMoveUp}
              onClick={() => { if (index > 0) void commands.move(effect.id, -1); }}
            >
              ↑
            </button>
            <button
              type="button"
              className="phone-fx__icon-button"
              aria-label="Move down"
              aria-disabled={index === stack.length - 1}
              data-testid={IDS.effectsMoveDown}
              onClick={() => { if (index < stack.length - 1) void commands.move(effect.id, 1); }}
            >
              ↓
            </button>
            <button
              type="button"
              className="phone-fx__icon-button phone-fx__icon-button--danger"
              aria-label={`Remove ${getEffectDisplayName(effect)}`}
              data-testid={IDS.effectsRemove}
              onClick={() => { void commands.remove(effect.id); }}
            >
              <PhoneIcon name="delete" size={20} />
            </button>
          </li>
        ))}
      </ul>
      {focused && <PrimarySlider key={focused.id} clip={clip} effect={focused} commands={commands} />}
      <PhoneProRow
        label="All parameters"
        detail="Keeps this sheet, opens Properties"
        testId={IDS.effectsAllParameters}
        onOpen={() => { void openAllParameters(); }}
      />
    </section>
  );
}
