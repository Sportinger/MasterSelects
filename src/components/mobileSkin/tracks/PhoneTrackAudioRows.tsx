// Track level and pan in the tracks sheet's "More" of an audio or MIDI track: the same values the
// desktop mixer's fader and pan knob write (setTrackAudioVolumeDb / setTrackAudioPan, clamped by the
// store to -60..+18 dB and -1..1). The sheet runs every change inside its own edit session, so a
// slider drag plus a typed value stay one undo step and Cancel restores the level exactly. MIDI
// tracks also get "Edit notes", which hands over to the landscape piano roll.

import type { TimelineTrack } from '../../../types/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { PhoneSliderRow } from '../audio/PhoneAudioControls';
import { ProButton } from '../compositions/phoneProControls';
import {
  PHONE_TRACK_VOLUME_FIELD_MAX_DB, PHONE_TRACK_VOLUME_MAX_DB, PHONE_TRACK_VOLUME_MIN_DB, formatPhoneTrackPan, formatPhoneTrackVolume,
} from './phoneTrackAudioFormat';
import { PHONE_TRACKS_TEST_IDS as IDS } from './phoneTracksTestIds';
import '../audio/PhoneAudioSheets.css';

interface Props {
  track: TimelineTrack;
  /** Runs one store change inside the sheet's edit session. */
  onVolume: (volumeDb: number) => void;
  onPan: (pan: number) => void;
  /** MIDI tracks: keep the sheet's changes and open the piano roll. */
  onEditNotes?: () => void;
}

export function PhoneTrackAudioRows({ track, onVolume, onPan, onEditNotes }: Props) {
  const volumeDb = track.audioState?.volumeDb ?? 0;
  const pan = track.audioState?.pan ?? 0;
  const locked = Boolean(track.locked);
  const explainLocked = () => usePhoneUiStore.getState().showUnavailable({
    actionId: IDS.volumeSlider, label: `${track.name} level`, reason: 'Unlock the track first.',
  });
  return (
    <div className="phone-tracks__audio" data-testid={IDS.audioRows} data-track-id={track.id}>
      <PhoneSliderRow
        id={`phone-track-volume-${track.id}`}
        label="Level"
        detail={formatPhoneTrackVolume(volumeDb)}
        sliderValue={Math.max(PHONE_TRACK_VOLUME_MIN_DB, Math.min(PHONE_TRACK_VOLUME_MAX_DB, volumeDb))}
        sliderMin={PHONE_TRACK_VOLUME_MIN_DB}
        sliderMax={PHONE_TRACK_VOLUME_MAX_DB}
        sliderStep={0.5}
        onSlide={onVolume}
        fieldValue={volumeDb}
        fieldDecimals={1}
        fieldMin={PHONE_TRACK_VOLUME_MIN_DB}
        fieldMax={PHONE_TRACK_VOLUME_FIELD_MAX_DB}
        fieldStep={0.5}
        fieldSuffix="dB"
        onField={(value) => onVolume(Math.max(PHONE_TRACK_VOLUME_MIN_DB, Math.min(PHONE_TRACK_VOLUME_FIELD_MAX_DB, value)))}
        onReset={() => onVolume(0)}
        disabled={locked}
        onDisabledTap={explainLocked}
        sliderTestId={IDS.volumeSlider}
        fieldTestId={IDS.volumeInput}
        resetTestId={IDS.volumeReset}
        valueText={formatPhoneTrackVolume(volumeDb)}
      />
      <PhoneSliderRow
        id={`phone-track-pan-${track.id}`}
        label="Pan"
        detail={formatPhoneTrackPan(pan)}
        sliderValue={Math.round(pan * 100)}
        sliderMin={-100}
        sliderMax={100}
        sliderStep={1}
        onSlide={(value) => onPan(value / 100)}
        fieldValue={Math.round(pan * 100)}
        fieldDecimals={0}
        fieldMin={-100}
        fieldMax={100}
        fieldStep={1}
        fieldSuffix="%"
        onField={(value) => onPan(Math.max(-100, Math.min(100, value)) / 100)}
        onReset={() => onPan(0)}
        resetLabel="Centre"
        disabled={locked}
        onDisabledTap={explainLocked}
        sliderTestId={IDS.panSlider}
        fieldTestId={IDS.panInput}
        resetTestId={IDS.panReset}
        valueText={formatPhoneTrackPan(pan)}
      />
      {onEditNotes ? (
        <ProButton label="Edit notes (piano roll)" testId={IDS.editNotes} onPress={onEditNotes} />
      ) : null}
    </div>
  );
}
