// 'speed' sheet for the selected clip. Normal: one logarithmic slider from 0.1x to 10x with preset
// chips, Keep pitch and Reverse. Curve: speed-ramp presets written as the editor's retime curve
// (phoneSpeedCurves). Every change applies live inside one owned edit session (phoneEditSession):
// the clip's length on the timeline follows like on the desktop, Done keeps everything as ONE undo
// step, Cancel restores the exact state from before. Options of the full editor that the phone
// does not have yet (freeze frame, fit to a length, editing curve points) stay visible and greyed.

import { useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneChoice, PhoneGreyedOption, PhoneSwitch, PhoneTabs, blurAfterPointer } from '../transition/phoneChoiceControls';
import {
  PHONE_SPEED_CHIPS, PHONE_SPEED_PREVIEW_RANGE, PHONE_SPEED_SLIDER_STEPS, applyPhoneSpeedState, formatPhoneSpeed,
  phoneSliderToSpeed, phoneSpeedLeftOutNote, phoneSpeedTarget, phoneSpeedToSlider, phoneSpeedUnavailableReason, readPhoneSpeedSnapshot,
  type PhoneSpeedCurveChoice, type PhoneSpeedDesired, type PhoneSpeedSnapshot,
} from './phoneSpeedCommands';
import { PHONE_SPEED_CURVES } from './phoneSpeedCurves';
import { PHONE_SPEED_TEST_IDS as IDS, phoneSpeedChipTestId, phoneSpeedCurveTestId } from './phoneSpeedTestIds';
import './PhoneSpeedSheet.css';

const LATER = 'Use the full editor meanwhile: tap the project name, then Full editor.';
const FREEZE_REASON = `Freeze frame arrives with the pro speed sheet (M3). ${LATER}`;
const FIT_REASON = `Fitting a clip to a length you type arrives with the pro speed sheet (M3). ${LATER}`;
const POINTS_REASON = `Moving single curve points needs the landscape curve editor (M4). ${LATER}`;
const KEYFRAME_CURVE_REASON = 'This clip already changes its speed with keyframes. A preset would silently override them, so presets stay off; edit the keyframes in the full editor.';
const REMAP_LABEL: Record<'freeze' | 'loop' | 'warp', string> = { freeze: 'a freeze frame', loop: 'a loop', warp: 'a speed curve' };

type Tab = 'normal' | 'curve';

export const PhoneSpeedSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const session = usePhoneEditSession('Speed');
  // The target is fixed when the sheet opens: the primary selection. Other selected clips stay as they are.
  const [target] = useState(phoneSpeedTarget);
  const [original] = useState<PhoneSpeedSnapshot | null>(() => (
    target.clip && phoneSpeedUnavailableReason(target.clip) === null ? readPhoneSpeedSnapshot(target.clip) : null
  ));
  const [unavailable] = useState(() => phoneSpeedUnavailableReason(target.clip));
  const leftOutNote = phoneSpeedLeftOutNote(target);
  const [tab, setTab] = useState<Tab>(original?.remapKind === 'warp' ? 'curve' : 'normal');
  const [desired, setDesired] = useState<PhoneSpeedDesired>(() => ({
    magnitude: Math.abs(original?.speed ?? 1),
    preservesPitch: original?.preservesPitch ?? true,
    reversed: original?.reversed ?? false,
    curve: 'keep',
  }));
  const [problems, setProblems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const liveDuration = useTimelineStore((state) => state.clips.find((clip) => clip.id === original?.clipId)?.duration);

  const update = (patch: Partial<PhoneSpeedDesired>) => {
    if (!original) return;
    const next = { ...desired, ...patch };
    // A constant speed cannot show through a freeze, loop or curve from the full editor: replacing it is explicit.
    if (patch.magnitude !== undefined && next.curve === 'keep' && original.remapKind && original.remapKind !== 'warp') next.curve = 'none';
    if (patch.magnitude !== undefined && next.curve === 'keep' && original.remapKind === 'warp') next.curve = original.curve ?? 'none';
    setDesired(next);
    let report: string[] = [];
    void session.apply(() => { report = applyPhoneSpeedState(original, next); }).then(() => setProblems(report));
  };

  const done = async () => {
    if (busy || !original) return;
    setBusy(true);
    const result = await session.commit(session.changed ? () => { applyPhoneSpeedState(original, desired); } : undefined);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const selectedCurve = useMemo<string>(() => {
    if (!original) return 'none';
    if (desired.curve !== 'keep') return desired.curve;
    if (original.remapKind === 'warp') return original.curve ?? 'custom';
    return 'none';
  }, [desired.curve, original]);

  if (!original) {
    return (
      <PhoneSheet title="Speed" onCancel={cancel} onDone={() => undefined} doneDisabled>
        <p className="phone-speed-sheet__note" data-testid={IDS.unavailable}>{unavailable}</p>
      </PhoneSheet>
    );
  }

  const speed = desired.magnitude;
  const outsidePreview = speed < PHONE_SPEED_PREVIEW_RANGE.min || speed > PHONE_SPEED_PREVIEW_RANGE.max;
  const remapNote = original.remapKind && desired.curve === 'keep'
    ? `This clip has ${REMAP_LABEL[original.remapKind]} from the full editor. Changing the speed or picking a preset replaces it.`
    : null;
  const keyframeNote = original.hasSpeedKeyframes
    ? 'This clip has speed keyframes: like on the desktop, the slider sets the speed at the playhead.'
    : null;
  const notes = [...problems, ...(remapNote ? [remapNote] : []), ...(keyframeNote ? [keyframeNote] : []),
    ...(outsidePreview ? ['The browser preview cannot keep up outside 0.25x–4x; the export uses the exact speed.'] : [])];

  return (
    <PhoneSheet title="Speed" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-speed-sheet">
        <p className="phone-speed-sheet__target" data-testid={IDS.target}>
          <span className="phone-speed-sheet__target-label">Clip</span>
          <span className="phone-speed-sheet__target-name">{original.name}</span>
        </p>
        {leftOutNote && <p className="phone-speed-sheet__note" role="note" data-testid={IDS.leftOut}>{leftOutNote}</p>}
        <PhoneTabs<Tab>
          label="Speed mode"
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'normal', label: 'Normal', testId: IDS.tabNormal },
            { id: 'curve', label: 'Curve', testId: IDS.tabCurve },
          ]}
        />
        {tab === 'normal' ? (
          <>
            <div className="phone-speed-sheet__readout">
              <span className="phone-speed-sheet__value" data-testid={IDS.value}>{formatPhoneSpeed(speed)}</span>
              <span className="phone-speed-sheet__duration" data-testid={IDS.duration}>
                {original.duration.toFixed(1)} s → {(liveDuration ?? original.duration).toFixed(1)} s
              </span>
            </div>
            <input
              type="range"
              className="phone-range"
              aria-label="Speed"
              aria-valuetext={formatPhoneSpeed(speed)}
              min={0}
              max={PHONE_SPEED_SLIDER_STEPS}
              step={1}
              value={phoneSpeedToSlider(speed)}
              data-testid={IDS.slider}
              onPointerUp={blurAfterPointer}
              onChange={(event) => update({ magnitude: phoneSliderToSpeed(Number(event.target.value)) })}
            />
            <div className="phone-speed-sheet__chips" role="group" aria-label="Preset speeds">
              {PHONE_SPEED_CHIPS.map((chip) => (
                <PhoneChoice
                  key={chip}
                  label={formatPhoneSpeed(chip)}
                  selected={Math.abs(speed - chip) < 1e-9}
                  testId={phoneSpeedChipTestId(chip)}
                  onSelect={() => update({ magnitude: chip })}
                />
              ))}
            </div>
            <PhoneSwitch
              label="Keep pitch"
              hint="Voices sound natural at other speeds"
              checked={desired.preservesPitch}
              testId={IDS.keepPitch}
              onChange={(preservesPitch) => update({ preservesPitch })}
            />
            <PhoneSwitch
              label="Reverse"
              hint="Plays the clip backwards"
              checked={desired.reversed}
              testId={IDS.reverse}
              onChange={(reversed) => update({ reversed })}
            />
            <PhoneGreyedOption label="Freeze frame" reason={FREEZE_REASON} testId={IDS.freeze} />
            <PhoneGreyedOption label="Fit to a length" reason={FIT_REASON} testId={IDS.fitLength} />
          </>
        ) : (
          <>
            <p className="phone-speed-sheet__note">
              A curve changes the pace inside the clip and keeps its length, around the base speed {formatPhoneSpeed(speed)}.
            </p>
            <div className="phone-speed-sheet__curves" role="group" aria-label="Speed curves">
              <PhoneChoice
                variant="tile"
                label="None"
                glyph="–"
                selected={selectedCurve === 'none'}
                testId={phoneSpeedCurveTestId('none')}
                onSelect={() => update({ curve: 'none' satisfies PhoneSpeedCurveChoice })}
              />
              {PHONE_SPEED_CURVES.map((preset) => (
                <PhoneChoice
                  key={preset.id}
                  variant="tile"
                  label={preset.label}
                  glyph={<CurveGlyph profile={preset.profile} />}
                  selected={selectedCurve === preset.id}
                  testId={phoneSpeedCurveTestId(preset.id)}
                  unavailableReason={original.hasSpeedKeyframes ? KEYFRAME_CURVE_REASON : null}
                  onSelect={() => update({ curve: preset.id })}
                />
              ))}
              {selectedCurve === 'custom' && (
                <PhoneChoice variant="tile" label="Custom" glyph="✎" selected testId={phoneSpeedCurveTestId('custom')} onSelect={() => undefined} />
              )}
            </div>
            <PhoneGreyedOption label="Edit curve points" reason={POINTS_REASON} testId={IDS.editPoints} />
          </>
        )}
        {notes.length > 0 && (
          <p className={`phone-speed-sheet__message${problems.length > 0 ? ' phone-speed-sheet__message--error' : ''}`} role="status" data-testid={IDS.message}>
            {notes.join(' ')}
          </p>
        )}
      </div>
    </PhoneSheet>
  );
};

/** A tiny drawing of a preset's speed profile (higher = faster). */
function CurveGlyph({ profile }: { profile: (u: number) => number }) {
  const samples = Array.from({ length: 13 }, (_, index) => profile(index / 12));
  const max = Math.max(...samples);
  const path = samples.map((value, index) => `${index === 0 ? 'M' : 'L'}${(index * 26) / 12 + 1} ${19 - (value / max) * 17}`).join(' ');
  return (
    <svg viewBox="0 0 28 20" width="28" height="20" aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}
