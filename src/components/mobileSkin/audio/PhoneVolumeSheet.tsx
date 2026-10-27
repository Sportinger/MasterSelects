// 'volume' sheet (clip scope): level (0..794 %, silence to +18 dB like the desktop Volume row), mute
// and fade in / fade out for the selected audio clips and the linked sound of selected video clips.
// Every change is live (preview and playback hear it) inside one phone edit session: Done commits
// ONE undo step, Cancel rolls back to the exact state before the sheet opened.

import { useRef, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  PHONE_VOLUME_MAX_DB,
  PHONE_VOLUME_MAX_PERCENT,
  PHONE_VOLUME_SILENCE_DB,
  clampPhoneFade,
  formatGainDb,
  gainToPercent,
  gainToSliderDb,
  percentToGain,
  phoneVolumeLockedNote,
  phoneVolumeStatusText,
  readPhoneClipAudio,
  resolvePhoneAudioTargets,
  sliderDbToGain,
  summarisePhoneAudioReadings,
  type PhoneAudioLevels,
} from './phoneAudioLevels';
import { writePhoneAudioLevels } from './phoneVolumeCommands';
import { blurAfterPointer, PhoneSliderRow, PhoneToggleButton, PhoneUnavailableList, type PhoneUnavailableItem } from './PhoneAudioControls';
import { PHONE_VOLUME_TEST_IDS as IDS } from './phoneAudioTestIds';
import './PhoneAudioSheets.css';

const FADE_SLIDER_MAX = 10;

const MORE: readonly PhoneUnavailableItem[] = [
  { id: 'pan', label: 'Pan', reason: 'This Volume sheet keeps to level and fades. To place this clip left or right, tap Audio effects below and add Pan; for a whole track use Tracks, More, Pan.' },
  { id: 'noise', label: 'Noise reduction', reason: 'Noise reduction is an audio effect: tap Audio effects below (or select the clip, then Audio effects) and add Noise Reduction. This Volume sheet keeps to level and fades.' },
];

function initialState() {
  const state = useTimelineStore.getState();
  const targets = resolvePhoneAudioTargets([...state.selectedClipIds], state.clips, state.tracks);
  const readings = targets.clipIds.flatMap((clipId) => {
    const clip = state.clips.find((candidate) => candidate.id === clipId);
    return clip ? [readPhoneClipAudio(clip, state.clipKeyframes.get(clipId) ?? [])] : [];
  });
  const names = targets.clipIds.map((clipId) => state.clips.find((clip) => clip.id === clipId)?.name ?? clipId);
  return { targets, summary: summarisePhoneAudioReadings(readings), names };
}

export const PhoneVolumeSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const openSheet = usePhoneUiStore((state) => state.openSheet);
  const session = usePhoneEditSession('Adjust volume');
  // Read once when the sheet opens; the sheet edits from this snapshot.
  const [initial] = useState(initialState);
  const { targets, summary, names } = initial;
  const [levels, setLevels] = useState<PhoneAudioLevels>(summary.levels);
  const [notes, setNotes] = useState<{ clamped: boolean; reEnabled: boolean; percentClamped: boolean }>({ clamped: false, reEnabled: false, percentClamped: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const levelsRef = useRef(levels);

  const blockedReason = targets.clipIds.length === 0
    ? targets.locked.length > 0
      ? 'The sound of this clip is on a locked track. Unlock the track in the full editor first.'
      : 'This clip has no sound. Select an audio clip or a video clip with sound.'
    : summary.automation
      ? 'This clip has drawn volume keyframes. Change them with the Keyframe tool or in the full editor; this sheet would overwrite them.'
      : null;
  const disabled = blockedReason !== null;
  const explain = () => {
    if (blockedReason) showUnavailable({ actionId: 'volume-blocked', label: 'Volume', reason: blockedReason });
  };

  const apply = (patch: Partial<PhoneAudioLevels>) => {
    if (disabled) return;
    const next = { ...levelsRef.current, ...patch };
    levelsRef.current = next;
    setLevels(next);
    void session.apply(() => {
      try {
        const result = writePhoneAudioLevels(targets.clipIds, next);
        setNotes((current) => ({ ...current, clamped: result.fadesClamped, reEnabled: current.reEnabled || result.reEnabled }));
        setError(null);
      } catch (cause) {
        setError(`Volume could not be changed: ${cause instanceof Error ? cause.message : String(cause)}.`);
      }
    });
  };

  const done = async () => {
    if (busy) return;
    if (disabled || !session.changed) {
      session.cancel();
      closeSheet();
      return;
    }
    setBusy(true);
    const final = levelsRef.current;
    const result = await session.commit(() => { writePhoneAudioLevels(targets.clipIds, final); });
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (busy) return;
    session.cancel();
    closeSheet();
  };

  /** Keeps this sheet's change (its own undo step) and opens the Audio effects sheet for the same clips. */
  const openAudioEffects = async () => {
    if (busy) return;
    setBusy(true);
    if (!disabled && session.changed) {
      const final = levelsRef.current;
      const result = await session.commit(() => { writePhoneAudioLevels(targets.clipIds, final); });
      if (!result.ok) showToast(result.message, 'error');
    } else {
      session.cancel();
    }
    openSheet('audioFx');
  };

  const fadeLimit = Math.max(0, summary.shortestDuration / 2);
  const fadeMax = Math.min(FADE_SLIDER_MAX, fadeLimit);
  const setFade = (edge: 'fadeIn' | 'fadeOut', seconds: number) => {
    const clamped = clampPhoneFade(seconds, summary.shortestDuration);
    apply({ [edge]: Math.round(clamped.seconds * 100) / 100 });
  };

  const noteLines = [
    phoneVolumeLockedNote(targets),
    summary.mixed ? 'The selected clips had different settings; Done gives them all these values.' : null,
    summary.bypassed || notes.reEnabled ? 'Volume was switched off (bypassed) in the full editor; changing it here switches it back on.' : null,
    notes.clamped ? `A fade can be at most half the clip (${fadeLimit.toFixed(2)} s); it was shortened.` : null,
    notes.percentClamped ? `The phone sets 0 to ${PHONE_VOLUME_MAX_PERCENT} % (+${PHONE_VOLUME_MAX_DB} dB). Louder levels need the full editor.` : null,
    levels.muted ? 'Muted: the clip stays silent in playback and export; its level is kept for later.' : null,
  ].filter((line): line is string => line !== null);

  return (
    <PhoneSheet title="Volume" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-audio-sheet">
        <p className="phone-audio-sheet__status" data-testid={IDS.status}>{phoneVolumeStatusText(names, targets)}</p>
        {blockedReason ? <p className="phone-audio-sheet__blocked" role="note">{blockedReason}</p> : null}

        <PhoneSliderRow
          id="phone-volume-level"
          label="Volume"
          detail={formatGainDb(levels.volume)}
          sliderValue={gainToSliderDb(levels.volume)}
          sliderMin={PHONE_VOLUME_SILENCE_DB}
          sliderMax={PHONE_VOLUME_MAX_DB}
          sliderStep={0.5}
          onSlide={(db) => apply({ volume: sliderDbToGain(db) })}
          fieldValue={gainToPercent(levels.volume)}
          fieldDecimals={0}
          fieldMin={0}
          fieldMax={PHONE_VOLUME_MAX_PERCENT}
          fieldStep={1}
          fieldSuffix="%"
          onField={(percent) => {
            const { gain, clamped } = percentToGain(percent);
            setNotes((current) => ({ ...current, percentClamped: clamped }));
            apply({ volume: gain });
          }}
          valueText={`${gainToPercent(levels.volume)} percent`}
          onReset={() => apply({ volume: 1 })}
          resetLabel="100%"
          disabled={disabled}
          onDisabledTap={explain}
          sliderTestId={IDS.levelSlider}
          fieldTestId={IDS.levelInput}
          resetTestId={IDS.levelReset}
        />

        <PhoneToggleButton
          pressed={levels.muted}
          testId={IDS.mute}
          disabled={disabled}
          onDisabledTap={explain}
          onToggle={() => apply({ muted: !levelsRef.current.muted })}
        >
          {levels.muted ? 'Muted · tap to unmute' : 'Mute'}
        </PhoneToggleButton>

        {(['fadeIn', 'fadeOut'] as const).map((edge) => (
          <PhoneSliderRow
            key={edge}
            id={`phone-volume-${edge}`}
            label={edge === 'fadeIn' ? 'Fade in' : 'Fade out'}
            sliderValue={Math.min(levels[edge], fadeMax)}
            sliderMin={0}
            sliderMax={Math.max(fadeMax, 0.1)}
            sliderStep={0.05}
            onSlide={(seconds) => setFade(edge, seconds)}
            fieldValue={levels[edge]}
            fieldDecimals={2}
            fieldMin={0}
            fieldMax={Number(fadeLimit.toFixed(2))}
            fieldStep={0.1}
            fieldSuffix="s"
            onField={(seconds) => setFade(edge, seconds)}
            valueText={`${levels[edge].toFixed(2)} seconds`}
            onReset={() => apply({ [edge]: 0 })}
            resetLabel="Off"
            disabled={disabled || fadeLimit <= 0}
            onDisabledTap={explain}
            sliderTestId={edge === 'fadeIn' ? IDS.fadeInSlider : IDS.fadeOutSlider}
            fieldTestId={edge === 'fadeIn' ? IDS.fadeInInput : IDS.fadeOutInput}
          />
        ))}

        {noteLines.length > 0 || error ? (
          <div className="phone-audio-sheet__notes" data-testid={IDS.note} role="status" aria-live="polite">
            {error ? <p className="phone-audio-sheet__error">{error}</p> : null}
            {noteLines.map((line) => <p key={line}>{line}</p>)}
          </div>
        ) : null}

        <button
          type="button"
          className="phone-audio-toggle"
          data-testid={IDS.audioEffects}
          aria-disabled={busy || undefined}
          onPointerUp={blurAfterPointer}
          onClick={() => { void openAudioEffects(); }}
        >
          Audio effects (EQ, compressor, reverb…)
        </button>

        <PhoneUnavailableList items={MORE} testIdPrefix={IDS.unavailablePrefix} heading="More audio tools" />
      </div>
    </PhoneSheet>
  );
};
