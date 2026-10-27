// Generate section of the Captions sheet: the transcription provider and account state, every speech
// source of the timeline with its transcript state (transcribe, progress, error, cancel), and the
// two ways to add captions - bound to one speech clip, or automatic over the whole timeline.

import { useState } from 'react';

import { useSettingsStore } from '../../../stores/settingsStore';
import { hasHostedAiSession, useAccountStore } from '../../../stores/accountStore';
import { useTimelineStore } from '../../../stores/timeline';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { blurAfterPointer } from '../audio/PhoneAudioControls';
import { middleTruncate } from '../transition/phoneMiddleTruncate';
import { PhoneChipRow } from '../transition/phoneSheetPrimitives';
import { formatPhoneCaptionTime, listPhoneSpeechSources, type PhoneSpeechSource } from './phoneCaptionModel';
import {
  cancelPhoneTranscription, PHONE_TRANSCRIPTION_PROVIDERS, phoneTranscribeBlocker, startPhoneTranscription, usePhoneTranscriptionReadiness,
} from './phoneTranscription';
import { PHONE_CAPTIONS_TEST_IDS as IDS } from './phoneCaptionsTestIds';

function sourceStateText(source: PhoneSpeechSource): string {
  if (source.status === 'transcribing') return `Transcribing · ${Math.round(source.progress)} %${source.message ? ` · ${source.message}` : ''}`;
  if (source.status === 'error') return `Failed: ${source.message ?? 'no reason given'}`;
  if (source.status === 'ready' || source.wordCount > 0) return `${source.wordCount} words`;
  return 'No transcript yet';
}

export function PhoneCaptionsGenerate({ onCreate, onSettings }: {
  onCreate: (input: { sourceClipId: string | null; startTime?: number; duration?: number }) => Promise<void>;
  onSettings: () => void;
}) {
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const provider = useSettingsStore((state) => state.transcriptionProvider);
  const setProvider = useSettingsStore((state) => state.setTranscriptionProvider);
  const signedIn = useAccountStore((state) => hasHostedAiSession(state.session));
  const readiness = usePhoneTranscriptionReadiness();
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const sources = listPhoneSpeechSources(clips, tracks);
  const [problem, setProblem] = useState<string | null>(null);
  const [queueing, setQueueing] = useState(false);
  const running = sources.some((source) => source.status === 'transcribing');
  const withWords = sources.filter((source) => source.wordCount > 0);
  const timelineEnd = clips.reduce((end, clip) => Math.max(end, clip.startTime + clip.duration), 0);

  const transcribe = async (source: PhoneSpeechSource) => {
    setProblem(null);
    const blocker = phoneTranscribeBlocker(source.clipId);
    if (blocker) {
      showUnavailable({ actionId: 'captions-transcribe', label: 'Transcribe', reason: blocker });
      return;
    }
    const failure = await startPhoneTranscription(source.clipId);
    if (failure) setProblem(`${source.name}: ${failure}`);
  };

  const transcribeAll = async () => {
    if (readiness.kind === 'needs-account') {
      showUnavailable({ actionId: 'captions-transcribe-all', label: 'Transcribe all', reason: readiness.reason });
      return;
    }
    const pending = sources.filter((source) => source.wordCount === 0 && source.status !== 'transcribing');
    if (pending.length === 0) { setProblem('Every speech clip already has a transcript.'); return; }
    setQueueing(true);
    setProblem(null);
    const failures: string[] = [];
    for (const source of pending) {
      const failure = await startPhoneTranscription(source.clipId);
      if (failure) failures.push(`${source.name}: ${failure}`);
    }
    setQueueing(false);
    if (failures.length > 0) setProblem(failures.join(' '));
  };

  const createFor = (source: PhoneSpeechSource) => {
    if (source.wordCount === 0) {
      showUnavailable({ actionId: 'captions-create-source', label: 'Add captions', reason: `${source.name} has no transcript yet. Transcribe it first.` });
      return;
    }
    void onCreate({ sourceClipId: source.clipId });
  };

  const createTimeline = () => {
    if (withWords.length === 0) {
      showUnavailable({ actionId: 'captions-create-timeline', label: 'Captions for the timeline', reason: 'No clip on the timeline has a transcript yet. Transcribe at least one speech clip first.' });
      return;
    }
    const start = Math.min(...withWords.map((source) => source.startTime));
    void onCreate({ sourceClipId: null, startTime: start, duration: Math.max(0.1, timelineEnd - start) });
  };

  return (
    <div className="phone-audio-section" role="tabpanel" aria-label="Generate captions">
      <div className="phone-captions__group" role="group" aria-label="Transcription">
        <span className="phone-captions__group-title">Speech to text</span>
        <p className="phone-audio-sheet__hint phone-captions__notice" data-testid={IDS.account} data-signed-in={signedIn} data-provider={provider} data-ready={readiness.kind === 'ready'}>
          {signedIn ? 'Signed in: hosted transcription uses your credits.' : (
            <>
              <span>Not signed in: only “On this phone” works.</span>
              <button type="button" className="phone-inline-link" data-testid={IDS.openSettings} onPointerUp={blurAfterPointer} onClick={onSettings}>
                Sign in
              </button>
            </>
          )}
        </p>
        <PhoneChipRow role="radiogroup" label="Transcription provider">
          {PHONE_TRANSCRIPTION_PROVIDERS.map((entry) => {
            // A provider that cannot run (hosted, signed out) is greyed and never shown selected, even
            // when it is the stored editor setting; the notice and "Transcribe on this phone" say why.
            const locked = entry.hosted && !signedIn;
            const selected = provider === entry.id && !locked;
            return (
              <button key={entry.id} type="button" role="radio" className="phone-captions__chip" aria-checked={selected}
                aria-pressed={selected} aria-disabled={locked || undefined} data-testid={IDS.provider} data-provider={entry.id}
                data-stored={provider === entry.id || undefined}
                onPointerUp={blurAfterPointer}
                onClick={() => {
                  if (locked) {
                    showUnavailable({ actionId: `captions-provider-${entry.id}`, label: entry.label, reason: `${entry.note} It needs a signed-in account: Settings, Account.` });
                    return;
                  }
                  setProvider(entry.id);
                }}>
                {entry.label}
              </button>
            );
          })}
        </PhoneChipRow>
        {readiness.kind === 'needs-account' ? (
          <button type="button" className="phone-primary-button" data-testid={IDS.useLocal} title={readiness.reason}
            onPointerUp={blurAfterPointer} onClick={() => setProvider('local')}>
            Transcribe on this phone
          </button>
        ) : (
          <p className="phone-audio-sheet__hint">{PHONE_TRANSCRIPTION_PROVIDERS.find((entry) => entry.id === provider)?.note}</p>
        )}
      </div>

      {sources.length === 0 ? (
        <p className="phone-audio-sheet__hint" data-testid={IDS.generateNote}>No video or audio clip on this timeline yet. Add media first.</p>
      ) : (
        <ul className="phone-audio-list" aria-label="Speech clips">
          {sources.map((source) => (
            <li key={source.clipId} className="phone-captions__source" data-testid={IDS.source} data-clip-id={source.clipId} data-transcript={source.status}>
              <span className="phone-captions__source-text">
                <span className="phone-audio-list__name" title={source.name}>{middleTruncate(source.name, 20)}</span>
                <span className="phone-audio-list__meta" data-testid={IDS.sourceState}>at {formatPhoneCaptionTime(source.startTime)} · {sourceStateText(source)}</span>
              </span>
              <button type="button" className={`phone-captions__small${source.wordCount === 0 && !running && readiness.kind === 'ready' ? ' phone-captions__small--primary' : ''}`} data-testid={IDS.sourceTranscribe}
                aria-disabled={running || readiness.kind === 'needs-account' || undefined} onPointerUp={blurAfterPointer}
                onClick={() => { if (!running) void transcribe(source); }}>
                {source.wordCount > 0 ? 'Again' : 'Transcribe'}
              </button>
              <button type="button" className={`phone-captions__small${source.wordCount > 0 ? ' phone-captions__small--primary' : ''}`} data-testid={IDS.sourceCreate}
                aria-disabled={source.wordCount === 0 || undefined} onPointerUp={blurAfterPointer} onClick={() => createFor(source)}>
                Add captions
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="phone-captions__row">
        <button type="button" className="phone-audio-toggle" data-testid={IDS.transcribeAll}
          aria-disabled={running || queueing || readiness.kind === 'needs-account' || sources.length === 0 || undefined}
          onPointerUp={blurAfterPointer} onClick={() => { if (!running && !queueing) void transcribeAll(); }}>
          {queueing ? 'Transcribing…' : 'Transcribe all'}
        </button>
        {running ? (
          <button type="button" className="phone-audio-toggle" data-testid={IDS.cancelTranscription} onPointerUp={blurAfterPointer}
            onClick={() => { void cancelPhoneTranscription(); }}>
            Stop
          </button>
        ) : null}
      </div>
      {problem ? <p className="phone-audio-sheet__error" role="alert" data-testid={IDS.generateNote}>{problem}</p> : null}

      <button type="button" className="phone-audio-big" data-testid={IDS.createTimeline}
        aria-disabled={withWords.length === 0 || undefined} onPointerUp={blurAfterPointer} onClick={createTimeline}>
        Add captions for the whole timeline
      </button>
    </div>
  );
}
