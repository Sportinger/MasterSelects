// 'adjust' sheet: colour controls on the editor's colour grade (phoneAdjustControls.ts). Tiles pick the
// visible slider, each value has Reset, and Reset all returns every control here to its default.
// All selected visual clips get the same values; the primary clip's values are shown. One cancellable
// session: Done = one undo step, Cancel = exact rollback (a grade the sheet created disappears again).
// With nothing selected everything stays visible but greyed, with the reason on tap.

import { useRef, useState } from 'react';

import { isParameterNodeDriven } from '../../../services/parameterSources/parameterSourceTargets';
import { useTimelineStore } from '../../../stores/timeline';
import type { RuntimePrimaryColorParams } from '../../../types/colorCorrection';
import { interpolateKeyframes } from '../../../utils/keyframeInterpolation';
import { PHONE_FULL_EDITOR_HINT, type PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import {
  formatPhoneAdjustValue, PHONE_ADJUST_CONTROLS, phoneAdjustProperty, setPhoneAdjustValues, type PhoneAdjustControl,
} from './phoneAdjustControls';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';
import { readPhoneVisualSelection } from './phoneEffectTargets';
import { blurPointerButton, PhoneValueSlider } from './PhoneValueSlider';
import './PhoneEffects.css';

type Key = keyof RuntimePrimaryColorParams;

const ROOT_REASON = 'Select a clip first: Adjust changes the colour of the selected clips. For the whole picture, use Effects with nothing selected: it adds an adjustment layer with Brightness, Contrast or Saturation.';
const WHEELS_REASON = `Colour wheels (lift, gamma, gain and offset per channel) come to the phone with milestone M3. ${PHONE_FULL_EDITOR_HINT}`;

/** The values the primary clip shows at the playhead, keyframes included. */
function usePrimaryValues(clipId: string | null): Record<Key, number> {
  const signature = useTimelineStore((state) => {
    const clip = clipId ? state.clips.find((candidate) => candidate.id === clipId) : undefined;
    const keyframes = clip ? state.clipKeyframes.get(clip.id) ?? [] : [];
    const local = clip ? Math.max(0, Math.min(clip.duration, state.playheadPosition - clip.startTime)) : 0;
    return PHONE_ADJUST_CONTROLS.map((control) => {
      const property = clip ? phoneAdjustProperty(clip, control.key) : null;
      if (!clip || !property) return control.def.defaultValue;
      const [, versionId, nodeId] = property.split('.');
      const base = clip.colorCorrection?.versions.find((version) => version.id === versionId)
        ?.nodes.find((node) => node.id === nodeId)?.params[control.key];
      return interpolateKeyframes(keyframes, property, local, typeof base === 'number' ? base : control.def.defaultValue);
    }).join('|');
  });
  const values = signature.split('|').map(Number);
  return Object.fromEntries(PHONE_ADJUST_CONTROLS.map((control, index) => [control.key, values[index]])) as Record<Key, number>;
}

export const PhoneAdjustSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Adjust colour');
  const selectionRef = useRef(readPhoneVisualSelection({ allowAdjustment: false }));
  const selection = selectionRef.current;
  const clipIds = selection.clips.map((clip) => clip.id);
  const primaryId = selection.primary?.id ?? null;
  const values = usePrimaryValues(primaryId);
  const touched = useRef<Partial<Record<Key, number>>>({});
  const [activeKey, setActiveKey] = useState<Key>(PHONE_ADJUST_CONTROLS[0].key);
  const [busy, setBusy] = useState(false);
  const primaryClip = useTimelineStore((state) => (primaryId ? state.clips.find((clip) => clip.id === primaryId) ?? null : null));
  const blocked = clipIds.length === 0;
  const blockedReason = selection.nothingSelected ? ROOT_REASON : selection.note ?? 'Select a clip with a picture first.';
  const active = PHONE_ADJUST_CONTROLS.find((control) => control.key === activeKey) ?? PHONE_ADJUST_CONTROLS[0];
  const activeProperty = primaryClip ? phoneAdjustProperty(primaryClip, active.key) : null;
  const driven = Boolean(primaryClip && activeProperty && isParameterNodeDriven(primaryClip, activeProperty));
  const keyframed = useTimelineStore((state) => Boolean(primaryId && activeProperty
    && (state.clipKeyframes.get(primaryId) ?? []).some((keyframe) => keyframe.property === activeProperty)));

  const set = (patch: Partial<Record<Key, number>>) => {
    Object.assign(touched.current, patch);
    void session.apply(() => setPhoneAdjustValues(clipIds, patch));
  };

  const selectTile = (control: PhoneAdjustControl) => {
    if (blocked) { showUnavailable({ actionId: `adjust-${control.key}`, label: control.label, reason: blockedReason }); return; }
    setActiveKey(control.key);
  };

  const resetAll = () => {
    if (blocked) { showUnavailable({ actionId: 'adjust-reset-all', label: 'Reset all', reason: blockedReason }); return; }
    const changed = PHONE_ADJUST_CONTROLS.filter((control) => Math.abs(values[control.key] - control.def.defaultValue) > control.def.step / 2);
    if (changed.length === 0) return;
    set(Object.fromEntries(changed.map((control) => [control.key, control.def.defaultValue])));
  };

  const done = async () => {
    if (busy) return;
    setBusy(true);
    const final = { ...touched.current };
    const result = await session.commit(Object.keys(final).length ? () => setPhoneAdjustValues(clipIds, final) : undefined);
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  const status = blocked
    ? blockedReason
    : `${selection.primary?.name ?? ''}${clipIds.length > 1 ? ` and ${clipIds.length - 1} more get the same values` : ''}`;

  return (
    <PhoneSheet title="Adjust" height="half" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-fx" onPointerUp={blurPointerButton}>
        <p className="phone-fx__target" data-testid={IDS.adjustStatus}>{status}</p>
        {!blocked && selection.note && <p className="phone-fx__note">{selection.note}</p>}
        <PhoneValueSlider
          label={active.label}
          value={values[active.key]}
          min={active.def.min}
          max={active.def.max}
          step={active.def.step}
          defaultValue={active.def.defaultValue}
          format={(value) => formatPhoneAdjustValue(active, value)}
          onChange={(value) => set({ [active.key]: value })}
          disabledReason={blocked ? blockedReason : driven ? `${active.label} is driven by a node, so it cannot be set here. ${PHONE_FULL_EDITOR_HINT}` : null}
          note={keyframed ? 'Keyframed: a change sets a key at the playhead.' : null}
        />
        <div className="phone-adjust__tiles" role="group" aria-label="Colour controls">
          {PHONE_ADJUST_CONTROLS.map((control) => (
            <button
              key={control.key}
              type="button"
              className="phone-adjust__tile"
              aria-pressed={!blocked && activeKey === control.key}
              aria-disabled={blocked}
              data-testid={IDS.adjustTile}
              data-adjust-key={control.key}
              data-changed={Math.abs(values[control.key] - control.def.defaultValue) > control.def.step / 2}
              onClick={() => selectTile(control)}
            >
              <span>{control.label}</span>
              <span className="phone-adjust__tile-value">{formatPhoneAdjustValue(control, values[control.key])}</span>
            </button>
          ))}
          <button
            type="button"
            className="phone-adjust__tile"
            aria-disabled="true"
            data-testid={IDS.adjustWheels}
            onClick={() => showUnavailable({ actionId: 'adjust-wheels', label: 'Colour wheels (M3)', reason: WHEELS_REASON })}
          >
            <span>Wheels</span>
            <span className="phone-adjust__tile-value">M3</span>
          </button>
        </div>
        <div className="phone-adjust__actions">
          <button type="button" className="phone-adjust__action" aria-disabled={blocked} data-testid={IDS.adjustResetAll} onClick={resetAll}>
            Reset all
          </button>
        </div>
      </div>
    </PhoneSheet>
  );
};
