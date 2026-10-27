// Level tab of the Sound range sheet: gain of the range in dB and its fade in/out, read from and
// written to the range's gain edit (the same values the desktop waveform's gain line and fade
// handles set), plus Silence. Values are absolute, so a later change carries the full state.

import type { TimelineAudioRegionSelection } from '../../../stores/timeline/types';
import type { TimelineClip } from '../../../types/timeline';
import { resolveAudioRegionGainControl } from '../../timeline/utils/activeRegionOverlays';
import { findSelectedGainOperation } from '../../timeline/interactionShell/clipAudioRegionControlsModel';
import { AUDIO_REGION_GAIN_MAX_DB, AUDIO_REGION_GAIN_MIN_DB } from '../../timeline/utils/audioRegionDisplay';
import type { AudioRegionContextMenuCommand } from '../../timeline/utils/audioRegionContextMenu';
import { blurAfterPointer, PhoneSliderRow } from '../audio/PhoneAudioControls';
import { PHONE_AUDIO_REGION_TEST_IDS as IDS } from './phoneAudioRegionTestIds';

interface Props {
  clip: TimelineClip;
  selection: TimelineAudioRegionSelection | null;
  disabled: boolean;
  onDisabledTap: () => void;
  silence: AudioRegionContextMenuCommand | undefined;
  onGain: (gainDb: number, fadeInSeconds: number, fadeOutSeconds: number) => void;
}

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function PhoneAudioRegionLevel({ clip, selection, disabled, onDisabledTap, silence, onGain }: Props) {
  const operation = selection ? findSelectedGainOperation(clip.audioState?.editStack ?? [], selection) : null;
  const control = resolveAudioRegionGainControl({ selection, overlayWidth: 1, selectedOperation: operation });
  const off = disabled || !control;
  const gainDb = control?.gainDb ?? 0;
  const fadeIn = control?.fadeInSeconds ?? 0;
  const fadeOut = control?.fadeOutSeconds ?? 0;
  const maxFade = control ? control.regionDuration / 2 : 0;

  const setGain = (value: number) => onGain(clamp(value, AUDIO_REGION_GAIN_MIN_DB, AUDIO_REGION_GAIN_MAX_DB), fadeIn, fadeOut);
  const setFadeIn = (value: number) => onGain(gainDb, clamp(value, 0, maxFade), fadeOut);
  const setFadeOut = (value: number) => onGain(gainDb, fadeIn, clamp(value, 0, maxFade));

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Level and fades">
      <PhoneSliderRow
        id="phone-region-gain" label="Gain" detail={operation ? 'range edit' : 'unchanged'}
        sliderValue={gainDb} sliderMin={AUDIO_REGION_GAIN_MIN_DB} sliderMax={AUDIO_REGION_GAIN_MAX_DB} sliderStep={0.5} onSlide={setGain}
        fieldValue={gainDb} fieldDecimals={1} fieldMin={AUDIO_REGION_GAIN_MIN_DB} fieldMax={AUDIO_REGION_GAIN_MAX_DB} fieldStep={0.5} fieldSuffix="dB" onField={setGain}
        disabled={off} onDisabledTap={onDisabledTap} onReset={() => onGain(0, 0, 0)} resetLabel="0 dB"
        sliderTestId={IDS.gainSlider} fieldTestId={IDS.gainInput} resetTestId={IDS.gainReset} valueText={`${gainDb.toFixed(1)} dB`}
      />
      <PhoneSliderRow
        id="phone-region-fade-in" label="Fade in"
        sliderValue={fadeIn} sliderMin={0} sliderMax={Math.max(0.001, maxFade)} sliderStep={0.005} onSlide={setFadeIn}
        fieldValue={fadeIn} fieldDecimals={3} fieldMin={0} fieldMax={maxFade} fieldStep={0.005} fieldSuffix="s" onField={setFadeIn}
        disabled={off} onDisabledTap={onDisabledTap}
        sliderTestId={IDS.fadeInSlider} fieldTestId={IDS.fadeInInput} valueText={`${fadeIn.toFixed(3)} s`}
      />
      <PhoneSliderRow
        id="phone-region-fade-out" label="Fade out"
        sliderValue={fadeOut} sliderMin={0} sliderMax={Math.max(0.001, maxFade)} sliderStep={0.005} onSlide={setFadeOut}
        fieldValue={fadeOut} fieldDecimals={3} fieldMin={0} fieldMax={maxFade} fieldStep={0.005} fieldSuffix="s" onField={setFadeOut}
        disabled={off} onDisabledTap={onDisabledTap}
        sliderTestId={IDS.fadeOutSlider} fieldTestId={IDS.fadeOutInput} valueText={`${fadeOut.toFixed(3)} s`}
      />
      {silence ? (
        <button type="button" className="phone-audio-toggle" data-testid={`${IDS.commandPrefix}level-silence`}
          aria-disabled={off || undefined} onPointerUp={blurAfterPointer}
          onClick={() => (off ? onDisabledTap() : silence.action())}>
          Silence the range
        </button>
      ) : null}
      <p className="phone-audio-sheet__hint">Gain changes only the selected range; fades shape its edges (at most half the range each).</p>
    </div>
  );
}
