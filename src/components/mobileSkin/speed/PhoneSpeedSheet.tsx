// 'speed' sheet for the selected clip. Normal: one logarithmic slider from 0.1x to 10x with preset
// chips, Keep pitch and Reverse. Curve: speed-ramp presets written as the editor's retime curve
// (phoneSpeedCurves). Every change applies live inside one owned edit session (phoneEditSession):
// the clip's length on the timeline follows like on the desktop, Done keeps everything as ONE undo
// step, Cancel restores the exact state from before. Fit to a length sets the speed from a typed
// length inside the same session; Freeze frame keeps the sheet's changes, then freezes the clip at the
// playhead as its own undo step (the desktop's freeze). Edit curve points keeps the sheet's changes and
// opens the landscape Curves editor with the clip selected and Properties open: its Retime section holds
// the desktop's warp point editor (time and source time per point, add and remove).

import { useMemo, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneSheetComponent } from '../contracts';
import { openPhoneEditor } from '../audiofx/phoneOpenEditor';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { phoneFitSpeed } from '../panels/phoneFitLength';
import { PhoneFitLengthRow, PhoneProRow } from '../panels/PhoneProRows';
import { PhoneChoice, PhoneSwitch, PhoneTabs, blurAfterPointer } from '../transition/phoneChoiceControls';
import {
  PHONE_SPEED_CHIPS, PHONE_SPEED_MAX, PHONE_SPEED_MIN, PHONE_SPEED_PREVIEW_RANGE, PHONE_SPEED_SLIDER_STEPS, applyPhoneSpeedState, formatPhoneSpeed,
  phoneSliderToSpeed, phoneSpeedLeftOutNote, phoneSpeedTarget, phoneSpeedToSlider, phoneSpeedUnavailableReason, readPhoneSpeedSnapshot,
  type PhoneSpeedCurveChoice, type PhoneSpeedDesired, type PhoneSpeedSnapshot,
} from './phoneSpeedCommands';
import { PHONE_SPEED_CURVES } from './phoneSpeedCurves';
import { PHONE_SPEED_TEST_IDS as IDS, phoneSpeedChipTestId, phoneSpeedCurveTestId } from './phoneSpeedTestIds';
import './PhoneSpeedSheet.css';

const FREEZE_OUTSIDE_REASON = 'Move the playhead inside this clip first: Freeze frame holds the frame under the playhead for the whole clip.';
const POINTS_REASON = 'Pick a curve first: its points then open in the Curves editor (Properties, Retime).';
const KEYFRAME_CURVE_REASON = 'This clip already changes its speed with keyframes. A preset would silently override them, so presets stay off; shape the keyframes in the Curves editor (Editors, Curves).';
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

  const fitLength = (seconds: number): string | null => {
    if (!original) return null;
    const fit = phoneFitSpeed(liveDuration ?? original.duration, desired.magnitude, seconds, PHONE_SPEED_MIN, PHONE_SPEED_MAX);
    if (!fit) return 'This clip has no length to fit.';
    update({ magnitude: fit.speed });
    return fit.clamped
      ? `The editor's speeds run from ${formatPhoneSpeed(PHONE_SPEED_MIN)} to ${formatPhoneSpeed(PHONE_SPEED_MAX)}, so the clip lasts ${fit.length.toFixed(2)} s.`
      : null;
  };

  // Freeze frame: keep this sheet's changes (one undo step), then the desktop's freeze at the playhead.
  const freeze = async () => {
    if (busy || !original) return;
    const timeline = useTimelineStore.getState();
    const clip = timeline.clips.find((candidate) => candidate.id === original.clipId);
    const local = clip ? timeline.playheadPosition - clip.startTime : -1;
    if (!clip || !(local >= 0 && local < clip.duration)) {
      usePhoneUiStore.getState().showUnavailable({ actionId: IDS.freeze, label: 'Freeze frame', reason: FREEZE_OUTSIDE_REASON });
      return;
    }
    setBusy(true);
    const result = await session.commit(session.changed ? () => { applyPhoneSpeedState(original, desired); } : undefined);
    closeSheet();
    if (!result.ok) { showToast(result.message, 'error'); return; }
    const frozen = useTimelineStore.getState().freezeClipAtPlayhead(original.clipId);
    showToast(frozen ? 'Frozen on the playhead frame. Undo brings the motion back.' : FREEZE_OUTSIDE_REASON, frozen ? 'info' : 'error');
  };

  // Edit curve points: keep this sheet's changes (one undo step), then the Curves editor on this clip.
  const editPoints = async () => {
    if (busy || !original) return;
    setBusy(true);
    const result = await session.commit(session.changed ? () => { applyPhoneSpeedState(original, desired); } : undefined);
    closeSheet();
    if (!result.ok) { showToast(result.message, 'error'); return; }
    openPhoneEditor('curves', { clipId: original.clipId, revealSide: 'right' });
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
            <PhoneProRow label="Freeze frame" detail="Holds the playhead frame" testId={IDS.freeze} onOpen={() => { void freeze(); }} />
            <PhoneFitLengthRow testId={IDS.fitLength} currentLength={liveDuration ?? original.duration} onFit={fitLength} />
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
            <PhoneProRow
              label="Edit curve points"
              detail="Curves editor"
              testId={IDS.editPoints}
              disabled={selectedCurve === 'none'}
              onOpen={() => {
                if (selectedCurve === 'none') usePhoneUiStore.getState().showUnavailable({ actionId: IDS.editPoints, label: 'Edit curve points', reason: POINTS_REASON });
                else void editPoints();
              }}
            />
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
