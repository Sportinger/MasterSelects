// Clean-up and AI sections of the Audio effects sheet: normalize, silence removal (the desktop
// silence cleanup: detect, then remove as edit operations), the repair suggestions and edit stack
// (desktop Properties, Edits tab), stem separation (the editor's background job with its real
// state) and speech, music and sound generation (AI Studio panel, with its own sign-in and
// credit state). Every row is reachable or greyed with its reason - nothing is left out.

import { useEffect, useRef, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer, PhoneSliderRow, PhoneToggleButton } from '../audio/PhoneAudioControls';
import { PHONE_SILENCE_DEFAULTS, type PhoneAudioFxCommands, type PhoneSilenceOptions } from './phoneAudioFxCommands';
import { PHONE_AUDIO_FX_TEST_IDS as IDS } from './phoneAudioFxTestIds';

const ACTIVE_STEM_PHASES = new Set(['queued', 'preparing', 'downloading-model', 'loading-model', 'separating', 'storing']);

export function PhoneAudioFxCleanup({ commands, isAudioFile, onRepair, onNormalized }: {
  commands: PhoneAudioFxCommands;
  /** Silence detection reads audio clips (not a video's own sound). */
  isAudioFile: boolean;
  onRepair: () => void;
  onNormalized: (effectId: string) => void;
}) {
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const [options, setOptions] = useState<PhoneSilenceOptions>(PHONE_SILENCE_DEFAULTS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  const runSilence = async () => {
    if (running) return;
    if (!isAudioFile) {
      showUnavailable({ actionId: 'audiofx-silence', label: 'Remove silence', reason: 'Silence removal works on audio clips. For a video, extract its sound first (Audio, Extract audio), then select the sound clip.' });
      return;
    }
    setRunning(true);
    setResult('Looking for silence…');
    const outcome = await commands.removeSilence(options);
    // The sheet may have closed meanwhile: a failure must still reach the person.
    if (!mountedRef.current) { if (outcome.kind === 'failed') usePhoneUiStore.getState().showToast(outcome.message, 'error'); return; }
    setRunning(false);
    setResult(outcome.kind === 'removed'
      ? `Removed ${outcome.count} silent ${outcome.count === 1 ? 'part' : 'parts'} (${outcome.seconds.toFixed(2)} s).`
      : outcome.kind === 'none' ? `No silence below ${options.thresholdDb} dB longer than ${options.minSilenceSeconds} s found.` : outcome.message);
  };

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Clean up">
      <button type="button" className="phone-audio-big" data-testid={IDS.normalize} onPointerUp={blurAfterPointer}
        onClick={() => {
          void commands.normalize().then((id) => {
            if (id) { onNormalized(id); showToast('Normalized to -1 dB peak.'); } else showToast('Normalize could not be added.', 'error');
          });
        }}>
        Normalize (peak -1 dB)
      </button>

      <div className="phone-audiofx__group" role="group" aria-label="Remove silence">
        <span className="phone-audiofx__group-title">Remove silence</span>
        <PhoneSliderRow
          id="phone-audiofx-silence"
          label="Below"
          sliderValue={options.thresholdDb}
          sliderMin={-80}
          sliderMax={-20}
          sliderStep={1}
          onSlide={(value) => setOptions((current) => ({ ...current, thresholdDb: value }))}
          fieldValue={options.thresholdDb}
          fieldDecimals={0}
          fieldMin={-80}
          fieldMax={-20}
          fieldStep={1}
          fieldSuffix="dB"
          onField={(value) => setOptions((current) => ({ ...current, thresholdDb: Math.min(-20, Math.max(-80, value)) }))}
          sliderTestId={IDS.silenceThresholdSlider}
          fieldTestId={IDS.silenceThreshold}
        />
        <PhoneToggleButton pressed={options.ripple} testId={IDS.silenceRipple}
          onToggle={() => setOptions((current) => ({ ...current, ripple: !current.ripple }))}>
          {options.ripple ? 'Close gaps: on' : 'Close gaps: off'}
        </PhoneToggleButton>
        <button type="button" className="phone-audio-big" data-testid={IDS.silenceRun}
          aria-disabled={running || !isAudioFile || undefined} onPointerUp={blurAfterPointer} onClick={() => { void runSilence(); }}>
          {running ? 'Working…' : 'Find and remove silence'}
        </button>
        {result ? <p className="phone-audio-sheet__hint" data-testid={IDS.silenceResult} role="status">{result}</p> : null}
      </div>

      <button type="button" className="phone-audio-toggle" data-testid={IDS.repair} onPointerUp={blurAfterPointer} onClick={onRepair}>
        Repair suggestions and edit list…
      </button>
    </div>
  );
}

export function PhoneAudioFxAi({ clipId, onAiStudio }: { clipId: string | null; onAiStudio: () => void }) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const job = useTimelineStore((state) => (clipId ? state.clipStemSeparationJobs[clipId] : undefined));
  const stems = useTimelineStore((state) => (clipId ? state.clips.find((clip) => clip.id === clipId)?.audioState?.stemSeparation?.stems.length ?? 0 : 0));
  const [startError, setStartError] = useState<string | null>(null);
  const active = Boolean(job && ACTIVE_STEM_PHASES.has(job.phase));

  const status = job
    ? job.phase === 'failed' ? `Stem separation failed: ${job.error ?? job.message ?? 'no reason given'}.`
      : job.phase === 'cancelled' ? 'Stem separation was cancelled.'
        : job.phase === 'complete' ? `Stems ready${stems ? ` (${stems})` : ''}. Mix them under All parameters.`
          : `${job.message ?? job.phase.replace(/-/g, ' ')} · ${Math.round(job.progress)} %`
    : stems > 0 ? `${stems} stems on this clip. Mix them under All parameters.` : 'Splits voice, drums, bass and the rest into stems. Runs on this device in the background; the first run downloads the model.';

  const start = () => {
    if (!clipId) {
      showUnavailable({ actionId: 'audiofx-stems', label: 'Separate stems', reason: 'Select a clip with sound first.' });
      return;
    }
    if (active) return;
    setStartError(null);
    void useTimelineStore.getState().startClipStemSeparation(clipId).then((jobId) => {
      if (!jobId && !useTimelineStore.getState().clipStemSeparationJobs[clipId]) setStartError('The editor did not start stem separation for this clip.');
    }).catch((error: unknown) => setStartError(`Stem separation could not start: ${error instanceof Error ? error.message : String(error)}.`));
  };

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="AI audio">
      <div className="phone-audiofx__group" role="group" aria-label="Separate stems">
        <span className="phone-audiofx__group-title">Separate stems</span>
        <p className="phone-audio-sheet__hint" data-testid={IDS.stemsStatus} role="status">{status}</p>
        {startError ? <p className="phone-audio-sheet__error" role="alert">{startError}</p> : null}
        {active ? (
          <button type="button" className="phone-audio-toggle" data-testid={IDS.stemsCancel} onPointerUp={blurAfterPointer}
            onClick={() => { if (clipId) useTimelineStore.getState().cancelClipStemSeparation(clipId); }}>
            Cancel separation
          </button>
        ) : (
          <button type="button" className="phone-audio-big" data-testid={IDS.stemsRun} aria-disabled={!clipId || undefined}
            onPointerUp={blurAfterPointer} onClick={start}>
            Separate stems
          </button>
        )}
      </div>
      <button type="button" className="phone-audio-big" data-testid={IDS.aiStudio} onPointerUp={blurAfterPointer} onClick={onAiStudio}>
        Speech, music and sounds (AI Studio)…
      </button>
      <p className="phone-audio-sheet__hint">Text to speech, AI music and sound effects run in AI Studio with your account and credits; it shows what is missing.</p>
    </div>
  );
}
