// Name, format, frame rate and duration of a composition: the "new composition" form and the
// settings form of the compositions sheet share it. Values stay local until the form is submitted.

import { useState } from 'react';

import { PHONE_PROJECT_FORMATS, type PhoneProjectFormatId } from '../contracts';
import { PhoneChoice } from '../transition/phoneChoiceControls';
import {
  PHONE_COMPOSITION_FRAME_RATES, PHONE_COMPOSITION_MAX_DURATION, PHONE_COMPOSITION_MIN_DURATION, clampPhoneCompositionDuration,
} from './phoneCompositionCommands';
import { PHONE_COMPOSITIONS_TEST_IDS as IDS, phoneCompositionFormatTestId, phoneCompositionFpsTestId } from './phoneCompositionsTestIds';
import { ProButton, ProSection, ProStepper, ProTextField } from './phoneProControls';

export interface PhoneCompositionFormValues {
  name: string;
  /** null keeps a size that matches no phone format (settings of a desktop-made composition). */
  format: PhoneProjectFormatId | null;
  frameRate: number;
  duration: number;
}

interface PhoneCompositionFormProps {
  initial: PhoneCompositionFormValues;
  submitLabel: string;
  /** The settings form edits the name elsewhere (Rename). */
  showName: boolean;
  /** Size of a composition whose format matches no chip, shown instead of a selected chip. */
  otherSize?: { width: number; height: number } | null;
  busy?: boolean;
  onSubmit: (values: PhoneCompositionFormValues) => void;
  onBack: () => void;
}

const FORMATS = Object.keys(PHONE_PROJECT_FORMATS) as PhoneProjectFormatId[];
const DURATION_STEPS = [{ label: '−10 s', delta: -10 }, { label: '−1 s', delta: -1 }, { label: '+1 s', delta: 1 }, { label: '+10 s', delta: 10 }];

function formatDuration(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} min ${rest} s` : `${rest} s`;
}

export function PhoneCompositionForm({ initial, submitLabel, showName, otherSize, busy, onSubmit, onBack }: PhoneCompositionFormProps) {
  const [values, setValues] = useState(initial);
  const patch = (next: Partial<PhoneCompositionFormValues>) => setValues((current) => ({ ...current, ...next }));
  const nameMissing = showName && !values.name.trim();
  const submit = () => { if (!busy && !nameMissing) onSubmit({ ...values, duration: clampPhoneCompositionDuration(values.duration) }); };

  return (
    <div className="phone-compositions__form">
      {showName ? (
        <ProTextField label="Name" value={values.name} testId={IDS.nameInput} onChange={(name) => patch({ name })} onSubmit={submit} />
      ) : null}
      <ProSection title="Format">
        <div className="phone-pro-chips" role="group" aria-label="Format">
          {FORMATS.map((format) => (
            <PhoneChoice
              key={format}
              label={format}
              selected={values.format === format}
              testId={phoneCompositionFormatTestId(format)}
              onSelect={() => patch({ format })}
            />
          ))}
        </div>
        {values.format === null && otherSize ? (
          <p className="phone-compositions__note">Keeps its size {otherSize.width}×{otherSize.height} unless you pick a format.</p>
        ) : null}
      </ProSection>
      <ProSection title="Frame rate">
        <div className="phone-pro-chips" role="group" aria-label="Frame rate">
          {PHONE_COMPOSITION_FRAME_RATES.map((fps) => (
            <PhoneChoice key={fps} label={`${fps} fps`} selected={values.frameRate === fps} testId={phoneCompositionFpsTestId(fps)} onSelect={() => patch({ frameRate: fps })} />
          ))}
        </div>
        {!PHONE_COMPOSITION_FRAME_RATES.includes(values.frameRate as (typeof PHONE_COMPOSITION_FRAME_RATES)[number]) ? (
          <p className="phone-compositions__note">Keeps its {values.frameRate} fps unless you pick one.</p>
        ) : null}
      </ProSection>
      <ProStepper
        label="Duration"
        value={formatDuration(values.duration)}
        steps={DURATION_STEPS}
        testId="phone-compositions-duration"
        onStep={(delta) => patch({ duration: Math.min(PHONE_COMPOSITION_MAX_DURATION, Math.max(PHONE_COMPOSITION_MIN_DURATION, values.duration + delta)) })}
      />
      <div className="phone-compositions__form-actions">
        <ProButton label="Back" testId={IDS.formBack} onPress={onBack} />
        <ProButton
          label={submitLabel}
          tone="primary"
          testId={IDS.formSubmit}
          unavailableReason={nameMissing ? 'Give the composition a name first.' : null}
          onPress={submit}
        />
      </div>
    </div>
  );
}
