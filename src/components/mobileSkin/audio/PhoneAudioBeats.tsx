// "Beats" tab of the Audio sheet: detect the beats of a music clip and line the clips of a video track
// up on them, with the editor's own actions. Detect runs the desktop's beat/onset analysis
// (generateBeatOnsetForClip, the same as Properties, Analysis); "Put on the beat" creates the
// desktop's beat rule (createBeatRule: clips in time order, one per beat or every 2nd/4th beat) on a
// detected beat grid or the composition tempo map. The rule lands inside the sheet's edit session
// (Done = one undo step, Cancel = gone) and stays editable in the Nodes editor ("Beat rules").

import { useMemo, useState } from 'react';

import { Logger } from '../../../services/logger';
import { createBeatRule } from '../../../services/compositionRules/beatRuleActions';
import { listBeatRuleSourceOptions } from '../../../services/compositionRules/beatRuleSource';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from './PhoneAudioControls';
import { PHONE_BEAT_STEPS, phoneBeatClipIds, phoneBeatTargetTracks, phoneDefaultBeatSource } from './phoneAudioBeatPlan';
import { PHONE_AUDIO_TEST_IDS as IDS } from './phoneAudioTestIds';

const log = Logger.create('PhoneAudioBeats');

const DETECT_AFTER_DONE = 'This sheet has changes that are not kept yet. Tap Done first, then open Audio, Beats again: detecting writes the beats into the clip right away.';

const WAVEFORM_WAIT_MS = 60_000;

/** Resolves once the clip's waveform is no longer being generated (or after WAVEFORM_WAIT_MS). */
function waitForWaveform(clipId: string): Promise<void> {
  const busy = () => useTimelineStore.getState().clips.find((clip) => clip.id === clipId)?.waveformGenerating === true;
  if (!busy()) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsubscribe();
      log.warn('The waveform was still being generated after waiting; detecting anyway', { clipId });
      resolve();
    }, WAVEFORM_WAIT_MS);
    const unsubscribe = useTimelineStore.subscribe((state) => state.clips, () => {
      if (busy()) return;
      window.clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

interface Props {
  session: PhoneEditSession;
  /** The sheet is importing or recording: nothing may start meanwhile. */
  busy: boolean;
  onBeatRules: () => void;
}

export function PhoneAudioBeats({ session, busy, onBeatRules }: Props) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const options = useMemo(() => listBeatRuleSourceOptions(clips), [clips]);
  const targets = useMemo(() => phoneBeatTargetTracks(tracks, clips), [tracks, clips]);
  const [sourceValue, setSourceValue] = useState(() => phoneDefaultBeatSource(options));
  const [trackId, setTrackId] = useState<string | null>(() => targets[0]?.id ?? null);
  const [step, setStep] = useState<(typeof PHONE_BEAT_STEPS)[number]>(1);
  const [detecting, setDetecting] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);

  // A detected clip changes its option value from "<id>:unanalyzed" to "<id>:source": follow it.
  const option = options.find((candidate) => candidate.value === sourceValue)
    ?? options.find((candidate) => candidate.value.split(':')[0] === sourceValue.split(':')[0] && candidate.source)
    ?? options[0];
  const target = targets.find((track) => track.id === trackId) ?? targets[0];
  const clipIds = target ? phoneBeatClipIds(clips, target.id) : [];

  const detect = (clipId: string) => {
    if (busy || detecting) return;
    if (session.changed) { showUnavailable({ actionId: IDS.beatsDetect, label: 'Detect beats', reason: DETECT_AFTER_DONE }); return; }
    const name = clips.find((clip) => clip.id === clipId)?.name ?? 'the clip';
    setDetecting(clipId);
    setMessage({ text: `Listening to ${name}…`, tone: 'info' });
    // The editor skips analysis while the clip's waveform is still being built: wait for it first.
    void waitForWaveform(clipId).then(() => useTimelineStore.getState().generateBeatOnsetForClip(clipId)).catch((error: unknown) => {
      log.error('Beat detection failed', error);
    }).then(() => {
      setDetecting(null);
      const clip = useTimelineStore.getState().clips.find((candidate) => candidate.id === clipId);
      const found = clip?.audioState?.sourceAnalysisRefs?.beatGridId ?? clip?.audioState?.processedAnalysisRefs?.beatGridId;
      if (found) {
        setSourceValue(`${clipId}:${clip?.audioState?.sourceAnalysisRefs?.beatGridId ? 'source' : 'processed'}`);
        setMessage({ text: `Beats of ${name} are ready.`, tone: 'info' });
      } else {
        log.warn('Beat detection finished without a beat grid', { clipId });
        setMessage({ text: `No beats could be detected in ${name} (see the log).`, tone: 'error' });
      }
    });
  };

  const place = () => {
    if (busy || placing || !option?.source || !target) return;
    const source = option.source;
    const ids = clipIds;
    setPlacing(true);
    setMessage(null);
    let outcome: Awaited<ReturnType<typeof createBeatRule>> | null = null;
    void session.apply(async () => {
      outcome = await createBeatRule({ clipIds: ids, source, params: { beatStep: step, targetTrackId: target.id }, label: 'Put on the beat' });
    }).then(() => {
      setPlacing(false);
      const result = outcome as Awaited<ReturnType<typeof createBeatRule>> | null;
      if (result?.success) {
        setMessage({ text: `${ids.length} clip${ids.length === 1 ? '' : 's'} of ${target.name} now start on the beat. Done keeps it, Cancel undoes it.`, tone: 'info' });
      } else {
        const reason = result?.conflicts.map((conflict) => conflict.message).join(' ') || 'The clips could not be put on the beat (see the log).';
        log.warn('Put on the beat was refused', { conflicts: result?.conflicts });
        setMessage({ text: reason, tone: 'error' });
      }
    });
  };

  const placeReason = !target ? 'Put clips on a video track first: their clips go on the beat in time order.'
    : !option?.source ? 'Detect the beats of this clip first.'
      : detecting ? 'Wait until the beats are detected.' : null;

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Beats">
      <span className="phone-audio-more__heading">Beats from</span>
      <div className="phone-audio-beats__chips" role="radiogroup" aria-label="Beats from">
        {options.map((candidate) => (
          <button key={candidate.value} type="button" role="radio" className="phone-audio-beats__chip" aria-checked={candidate.value === option?.value}
            data-testid={IDS.beatsSource} data-value={candidate.value} onPointerUp={blurAfterPointer} onClick={() => setSourceValue(candidate.value)}>
            {candidate.source?.kind === 'tempo-map' ? 'Tempo map' : candidate.label}
          </button>
        ))}
      </div>
      {option?.analysisClipId ? (
        <button type="button" className="phone-audio-big" data-testid={IDS.beatsDetect}
          aria-disabled={busy || Boolean(detecting) || session.changed || undefined}
          onPointerUp={blurAfterPointer} onClick={() => detect(option.analysisClipId!)}>
          {detecting ? 'Detecting beats…' : 'Detect beats'}
        </button>
      ) : null}

      <span className="phone-audio-more__heading">Clips of</span>
      <div className="phone-audio-beats__chips" role="radiogroup" aria-label="Clips of">
        {targets.map((track) => (
          <button key={track.id} type="button" role="radio" className="phone-audio-beats__chip" aria-checked={track.id === target?.id}
            data-testid={IDS.beatsTrack} data-track-id={track.id} onPointerUp={blurAfterPointer} onClick={() => setTrackId(track.id)}>
            {track.name}
          </button>
        ))}
      </div>
      <span className="phone-audio-more__heading">One clip per</span>
      <div className="phone-audio-beats__chips" role="radiogroup" aria-label="One clip per">
        {PHONE_BEAT_STEPS.map((value) => (
          <button key={value} type="button" role="radio" className="phone-audio-beats__chip" aria-checked={value === step}
            data-testid={IDS.beatsStep} data-step={value} onPointerUp={blurAfterPointer} onClick={() => setStep(value)}>
            {value === 1 ? 'Beat' : `${value} beats`}
          </button>
        ))}
      </div>
      <button type="button" className="phone-audio-big" data-testid={IDS.beatsPlace} aria-disabled={Boolean(placeReason) || busy || placing || undefined}
        onPointerUp={blurAfterPointer}
        onClick={() => {
          if (placeReason) { showUnavailable({ actionId: IDS.beatsPlace, label: 'Put on the beat', reason: placeReason }); return; }
          place();
        }}>
        {placing ? 'Placing…' : clipIds.length > 0 ? `Put ${clipIds.length} clip${clipIds.length === 1 ? '' : 's'} on the beat` : 'Put clips on the beat'}
      </button>
      {message ? (
        <p className={message.tone === 'error' ? 'phone-audio-sheet__error' : 'phone-audio-sheet__hint'} role="status" data-testid={IDS.beatsMessage}>{message.text}</p>
      ) : null}
      <button type="button" className="phone-audio-toggle" data-testid={IDS.beatsRules} onPointerUp={blurAfterPointer} onClick={onBeatRules}>
        Beat rules in the Nodes editor…
      </button>
    </div>
  );
}
