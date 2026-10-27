// Applied audio effects of the target clip in processing order: tap a name to focus its main
// slider, switch it on/off, move it up/down or remove it. The main slider writes absolute values;
// frequencies slide on a log scale and every value can be typed.

import type { AudioEffectInstance } from '../../../types/audio';
import { useTimelineStore } from '../../../stores/timeline';
import { createEffectProperty } from '../../../types/animationProperties';
import { blurAfterPointer, PhoneSliderRow } from '../audio/PhoneAudioControls';
import { PhoneIcon } from '../shell/phoneIcons';
import { phoneAudioFxMainParam, phoneAudioFxName, readPhoneAudioParam } from './phoneAudioFxCatalog';
import type { PhoneAudioFxCommands } from './phoneAudioFxCommands';
import { PHONE_AUDIO_FX_TEST_IDS as IDS } from './phoneAudioFxTestIds';

interface StackProps {
  clipId: string;
  stack: readonly AudioEffectInstance[];
  focusedId: string | null;
  onFocus: (effectId: string) => void;
  commands: PhoneAudioFxCommands;
}

function MainSlider({ clipId, effect, commands }: { clipId: string; effect: AudioEffectInstance; commands: PhoneAudioFxCommands }) {
  const ui = phoneAudioFxMainParam(effect.descriptorId);
  const keyframed = useTimelineStore((state) => Boolean(ui && (state.clipKeyframes.get(clipId) ?? [])
    .some((keyframe) => keyframe.property === createEffectProperty(effect.id, ui.name))));
  if (!ui) {
    return (
      <p className="phone-audiofx__note" data-testid={IDS.mainNote}>
        {phoneAudioFxName(effect.descriptorId)} has no single main value: it is on or off here. Its settings are under All parameters.
      </p>
    );
  }
  const value = readPhoneAudioParam(effect.params, effect.descriptorId, ui.name);
  const logScale = ui.suffix === 'Hz' && ui.min > 0;
  const toSlider = (next: number) => (logScale ? Math.log10(Math.max(ui.min, next)) : next);
  const fromSlider = (next: number) => (logScale ? Math.round(Math.pow(10, next)) : next);
  const clamp = (next: number) => Math.min(ui.max, Math.max(ui.min, next));
  const set = (next: number) => { void commands.setParam(effect.id, ui.name, clamp(next)); };
  const label = `${phoneAudioFxName(effect.descriptorId)} · ${ui.label}`;
  return (
    <div className="phone-audiofx__main">
      <PhoneSliderRow
        id={`phone-audiofx-${effect.id}`}
        label={label}
        sliderValue={toSlider(clamp(value))}
        sliderMin={toSlider(ui.min)}
        sliderMax={toSlider(ui.max)}
        sliderStep={logScale ? 0.005 : ui.step}
        onSlide={(next) => set(fromSlider(next))}
        fieldValue={value}
        fieldDecimals={ui.decimals}
        fieldMin={ui.min}
        fieldMax={ui.max}
        fieldStep={ui.step}
        fieldSuffix={ui.suffix}
        onField={set}
        valueText={`${value.toFixed(ui.decimals)} ${ui.suffix}`.trim()}
        onReset={() => set(ui.defaultValue)}
        resetLabel="Reset"
        sliderTestId={IDS.mainSlider}
        fieldTestId={IDS.mainInput}
        resetTestId={IDS.mainReset}
      />
      {keyframed ? <p className="phone-audiofx__note" data-testid={IDS.mainNote}>Keyframed: a change sets a key at the playhead.</p> : null}
      {value < ui.min || value > ui.max ? (
        <p className="phone-audiofx__note" data-testid={IDS.mainNote}>The stored value lies outside {ui.min} to {ui.max}; a change here brings it back in.</p>
      ) : null}
    </div>
  );
}

export function PhoneAudioFxStack({ clipId, stack, focusedId, onFocus, commands }: StackProps) {
  if (stack.length === 0) {
    return <p className="phone-audiofx__note" data-testid={IDS.empty}>No audio effects on this clip yet. Tap one below to add it.</p>;
  }
  const focused = stack.find((effect) => effect.id === focusedId) ?? stack.at(-1) ?? null;
  return (
    <section className="phone-audiofx__stack" aria-label="Applied audio effects">
      <ul className="phone-audiofx__rows">
        {stack.map((effect, index) => {
          const name = phoneAudioFxName(effect.descriptorId);
          return (
            <li
              key={effect.id}
              className="phone-audiofx__row"
              data-testid={IDS.row}
              data-effect-id={effect.id}
              data-descriptor={effect.descriptorId}
              data-enabled={effect.enabled !== false}
              aria-selected={focused?.id === effect.id}
            >
              <button type="button" className="phone-audiofx__row-name" data-testid={IDS.rowFocus}
                onPointerUp={blurAfterPointer} onClick={() => onFocus(effect.id)}>
                {name}
              </button>
              <button
                type="button"
                className="phone-audiofx__switch"
                role="switch"
                aria-checked={effect.enabled !== false}
                aria-label={`${name} on`}
                data-testid={IDS.toggle}
                onPointerUp={blurAfterPointer}
                onClick={() => { void commands.setEnabled(effect.id, effect.enabled === false); }}
              >
                <span className="phone-audiofx__switch-knob" aria-hidden="true" />
              </button>
              <button type="button" className="phone-audiofx__icon" aria-label={`Move ${name} up`} aria-disabled={index === 0 || undefined}
                data-testid={IDS.moveUp} onPointerUp={blurAfterPointer}
                onClick={() => { if (index > 0) void commands.move(effect.id, -1); }}>
                ↑
              </button>
              <button type="button" className="phone-audiofx__icon" aria-label={`Move ${name} down`} aria-disabled={index === stack.length - 1 || undefined}
                data-testid={IDS.moveDown} onPointerUp={blurAfterPointer}
                onClick={() => { if (index < stack.length - 1) void commands.move(effect.id, 1); }}>
                ↓
              </button>
              <button type="button" className="phone-audiofx__icon phone-audiofx__icon--danger" aria-label={`Remove ${name}`}
                data-testid={IDS.remove} onPointerUp={blurAfterPointer}
                onClick={() => { void commands.remove(effect.id); }}>
                <PhoneIcon name="delete" size={20} />
              </button>
            </li>
          );
        })}
      </ul>
      {focused ? <MainSlider key={focused.id} clipId={clipId} effect={focused} commands={commands} /> : null}
    </section>
  );
}
