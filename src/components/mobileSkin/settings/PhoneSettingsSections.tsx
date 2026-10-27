// Sections of the phone Settings sheet that edit the shared draft: touch and input display, the
// assistant's action replay, and the preview/display limits that stay greyed with their reason.
import { useState } from 'react';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { MAX_SHORTCUT_DISPLAY_SCALE, MIN_SHORTCUT_DISPLAY_SCALE } from '../../../stores/settings/settingsOptions';
import { PHONE_TOUCH_DOT_SIZE } from '../preview/phoneTouchDisplayIds';
import {
  PHONE_BUDGET_UNITS, PHONE_INPUT_DISPLAY_DEFAULTS, PHONE_REPLAY_COMPRESSION, PHONE_REPLAY_DEFAULTS, PHONE_REPLAY_MODES,
  parsePhoneBudget, phoneBudgetUnitFor, type PhoneBudgetUnit, type PhoneSettingsDraft,
} from './phoneSettingsModel';
import { PHONE_SETTINGS_TEST_IDS as IDS } from './phoneSettingsTestIds';
import { PHONE_SETTINGS_LIMITS } from './phoneSettingsLimits';

type SetDraft = <K extends keyof PhoneSettingsDraft>(key: K, value: PhoneSettingsDraft[K]) => void;
interface SectionProps { draft: PhoneSettingsDraft; set: SetDraft }


function Chips<T extends string>({ label, testId, options, value, disabled, onChange }: {
  label: string; testId: string; options: ReadonlyArray<{ id: T; label: string }>; value: T; disabled?: string; onChange: (next: T) => void;
}) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  return (
    <div className="phone-settings__chips" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.id} type="button" role="radio" className="phone-lib__chip" data-testid={testId} data-value={option.id}
          aria-checked={value === option.id} aria-disabled={disabled ? true : undefined}
          onClick={() => {
            if (disabled) showUnavailable({ actionId: testId, label, reason: disabled });
            else onChange(option.id);
          }}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PhoneTouchInputSection({ draft, set }: SectionProps) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const size = Math.round(PHONE_TOUCH_DOT_SIZE * draft.shortcutDisplayScale);
  return (
    <>
      <h3 className="phone-lib__section">Touch and input</h3>
      <button type="button" role="switch" className="phone-settings__toggle" data-testid={IDS.showTouches} aria-checked={draft.showShortcutDisplay}
        onClick={() => set('showShortcutDisplay', !draft.showShortcutDisplay)}>
        <span>Show touches<small>A ring follows every finger, for screen recordings. Same setting as the full editor’s input display.</small></span>
        <span className="phone-settings__state">{draft.showShortcutDisplay ? 'On' : 'Off'}</span>
      </button>
      <label className="phone-settings__slider">Size
        <input type="range" min={MIN_SHORTCUT_DISPLAY_SCALE} max={MAX_SHORTCUT_DISPLAY_SCALE} step={0.05} value={draft.shortcutDisplayScale}
          data-testid={IDS.touchSize} onChange={(event) => set('shortcutDisplayScale', Number(event.target.value))} />
        <span>{Math.round(draft.shortcutDisplayScale * 100)}%</span>
      </label>
      <div className="phone-settings__touch-sample" aria-hidden="true">
        <span data-testid={IDS.touchSample} data-size={size} style={{ width: size, height: size }} />
      </div>
      <div className="phone-lib__bar">
        <button type="button" className="phone-lib__button" data-testid={IDS.touchReset}
          onClick={() => {
            set('showShortcutDisplay', PHONE_INPUT_DISPLAY_DEFAULTS.showShortcutDisplay);
            set('shortcutDisplayScale', PHONE_INPUT_DISPLAY_DEFAULTS.shortcutDisplayScale);
          }}>
          Reset
        </button>
      </div>
      <button type="button" className="phone-settings__toggle" data-testid={IDS.touchGoo} aria-disabled="true"
        onClick={() => showUnavailable({ actionId: 'settings-touch-goo', label: 'Goo touch feedback', reason: PHONE_SETTINGS_LIMITS.touchGoo })}>
        <span>Goo touch feedback<small>Full editor only</small></span>
        <span className="phone-settings__state">›</span>
      </button>
    </>
  );
}

export function PhoneAssistantReplaySection({ draft, set }: SectionProps) {
  const [unit, setUnit] = useState<PhoneBudgetUnit>(() => phoneBudgetUnitFor(draft.replayBudgetMs));
  const factor = PHONE_BUDGET_UNITS.find((entry) => entry.id === unit)!.ms;
  const [text, setText] = useState(() => String(draft.replayBudgetMs / factor));
  const off = draft.replayMode === 'off';
  const offReason = 'Replay is off: the assistant changes the timeline without showing the steps. Pick Short or Full first.';
  return (
    <>
      <h3 className="phone-lib__section">Assistant</h3>
      <p className="phone-lib__note">How the assistant shows its steps on the timeline while it works. It only changes what you see, never the result.</p>
      <Chips label="Action replay" testId={IDS.replayMode} options={PHONE_REPLAY_MODES} value={draft.replayMode} onChange={(next) => set('replayMode', next)} />
      <div className="phone-settings__budget">
        <label>Time
          <input className="phone-lib__input" inputMode="decimal" data-testid={IDS.replayBudget} value={text} aria-disabled={off} readOnly={off}
            onChange={(event) => {
              setText(event.target.value);
              set('replayBudgetMs', parsePhoneBudget(event.target.value, unit, draft.replayBudgetMs));
            }} />
        </label>
        <Chips label="Time unit" testId={IDS.replayUnit} options={PHONE_BUDGET_UNITS} value={unit} disabled={off ? offReason : undefined}
          onChange={(next) => {
            setUnit(next);
            set('replayBudgetMs', parsePhoneBudget(text, next, draft.replayBudgetMs));
          }} />
      </div>
      <Chips label="Grouping" testId={IDS.replayCompression} options={PHONE_REPLAY_COMPRESSION} value={draft.replayCompression}
        disabled={off ? offReason : draft.replayBudgetMs === 0 ? 'With a time of 0 the steps are checked but not animated, so there is nothing to group.' : undefined}
        onChange={(next) => set('replayCompression', next)} />
      <div className="phone-lib__bar">
        <button type="button" className="phone-lib__button" data-testid={IDS.replayReset}
          onClick={() => {
            set('replayMode', PHONE_REPLAY_DEFAULTS.replayMode);
            set('replayBudgetMs', PHONE_REPLAY_DEFAULTS.replayBudgetMs);
            set('replayCompression', PHONE_REPLAY_DEFAULTS.replayCompression);
            const nextUnit = phoneBudgetUnitFor(PHONE_REPLAY_DEFAULTS.replayBudgetMs);
            setUnit(nextUnit);
            setText(String(PHONE_REPLAY_DEFAULTS.replayBudgetMs / PHONE_BUDGET_UNITS.find((entry) => entry.id === nextUnit)!.ms));
          }}>
          Reset
        </button>
      </div>
    </>
  );
}

export function PhonePreviewDisplaySection() {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const row = (testId: string, label: string, hint: string, reason: string) => (
    <button type="button" className="phone-settings__toggle" data-testid={testId} aria-disabled="true"
      onClick={() => showUnavailable({ actionId: testId, label, reason })}>
      <span>{label}<small>{hint}</small></span>
      <span className="phone-settings__state">›</span>
    </button>
  );
  return (
    <>
      <h3 className="phone-lib__section">Preview and displays</h3>
      <p className="phone-lib__note" data-testid={IDS.renderer}>Renderer: WebGPU on this phone (preview and export).</p>
      <div className="phone-settings__group">
        {row(IDS.externalDisplay, 'Second screen output', 'Not on a phone', PHONE_SETTINGS_LIMITS.externalDisplay)}
        {row(IDS.optix, 'Native OptiX renderer', 'Needs an NVIDIA desktop', PHONE_SETTINGS_LIMITS.optix)}
        {row(IDS.localModels, 'Local AI models', 'Desktop native helper', PHONE_SETTINGS_LIMITS.localModels)}
      </div>
    </>
  );
}
