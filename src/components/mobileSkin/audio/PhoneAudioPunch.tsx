// "Record a range" (punch-in) in the Audio sheet's Voiceover tab: punch-in and punch-out as typed
// seconds or set from the playhead, the waiting / recording status, and the automatic stop.

import { useEffect, useState } from 'react';

import { useTimelineStore } from '../../../stores/timeline';
import { blurAfterPointer, parsePhoneDecimal } from './PhoneAudioControls';
import { formatPhoneAudioTime } from './phoneAudioTimeline';
import { PHONE_AUDIO_TEST_IDS as IDS } from './phoneAudioTestIds';
import { PHONE_PUNCH_PREROLL_SECONDS, type PhonePunchRecording } from './usePhonePunchRecording';

function SecondsInput({ testId, value, onCommit, disabled }: { testId: string; value: number; onCommit: (value: number) => void; disabled: boolean }) {
  const shown = value.toFixed(2);
  const [draft, setDraft] = useState(shown);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!editing) setDraft(shown); }, [editing, shown]);
  return (
    <input className="phone-audio-row__field" type="text" inputMode="decimal" autoComplete="off" spellCheck={false} value={draft} readOnly={disabled}
      aria-disabled={disabled || undefined} data-testid={testId}
      onFocus={() => setEditing(true)}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        setEditing(false);
        const parsed = parsePhoneDecimal(draft);
        if (Number.isFinite(parsed) && !disabled) onCommit(Math.max(0, parsed));
      }}
      onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
  );
}

const PHASE_TEXT: Record<string, string> = {
  starting: 'Preparing…',
  'waiting-for-punch': 'Playing the pre-roll; recording starts at punch-in.',
  'warming-input': 'Microphone warming up…',
  'requesting-input': 'Asking for the microphone…',
  recording: 'Recording. It stops by itself at punch-out.',
  stopping: 'Saving the take…',
};

export function PhoneAudioPunch({ punch, blocked, onBlockedTap }: { punch: PhonePunchRecording; blocked: string | null; onBlockedTap: (reason: string) => void }) {
  const fromPlayhead = (edge: 'in' | 'out') => {
    const time = useTimelineStore.getState().playheadPosition;
    if (edge === 'in') punch.setPunchIn(time);
    else punch.setPunchOut(time);
  };
  const reason = blocked ?? punch.rangeProblem;

  return (
    <div className="phone-audio-recovery" role="group" aria-label="Record a range" data-testid={IDS.punch} data-phase={punch.phase}>
      <span className="phone-audio-more__heading">Record a range (punch-in)</span>
      <div className="phone-audio-punch__row">
        <label className="phone-audio-punch__field">
          <span>In</span>
          <SecondsInput testId={IDS.punchIn} value={punch.punchIn} onCommit={punch.setPunchIn} disabled={punch.active} />
        </label>
        <button type="button" className="phone-audio-toggle" data-testid={IDS.punchInFromPlayhead} aria-disabled={punch.active || undefined}
          onPointerUp={blurAfterPointer} onClick={() => { if (!punch.active) fromPlayhead('in'); }}>Playhead</button>
      </div>
      <div className="phone-audio-punch__row">
        <label className="phone-audio-punch__field">
          <span>Out</span>
          <SecondsInput testId={IDS.punchOut} value={punch.punchOut} onCommit={punch.setPunchOut} disabled={punch.active} />
        </label>
        <button type="button" className="phone-audio-toggle" data-testid={IDS.punchOutFromPlayhead} aria-disabled={punch.active || undefined}
          onPointerUp={blurAfterPointer} onClick={() => { if (!punch.active) fromPlayhead('out'); }}>Playhead</button>
      </div>
      {punch.active ? (
        <button type="button" className="phone-audio-big phone-audio-big--recording" data-testid={IDS.punchStop}
          onPointerUp={blurAfterPointer} onClick={() => { void punch.stop(); }}>
          {punch.phase === 'recording' ? 'Stop early' : 'Cancel the range recording'}
        </button>
      ) : (
        <button type="button" className="phone-audio-big" data-testid={IDS.punchStart} aria-disabled={Boolean(reason) || undefined}
          onPointerUp={blurAfterPointer} onClick={() => { if (reason) onBlockedTap(reason); else void punch.start(); }}>
          Record {formatPhoneAudioTime(punch.punchIn)} – {formatPhoneAudioTime(punch.punchOut)}
        </button>
      )}
      <p className="phone-audio-sheet__hint" data-testid={IDS.punchStatus}>
        {PHASE_TEXT[punch.phase] ?? `Plays from ${PHONE_PUNCH_PREROLL_SECONDS} s before punch-in, records only between in and out, then stops and adds the take there.`}
      </p>
      {punch.error ? <p className="phone-audio-sheet__error" role="alert">{punch.error}</p> : null}
      {punch.takes.length > 0 ? (
        <ul className="phone-audio-list">
          {punch.takes.map((take) => (
            <li key={take.clipId} className="phone-audio-list__item" data-testid={IDS.punchTake}>
              <span className="phone-audio-list__name">{take.name}</span>
              <span className="phone-audio-list__meta">at {formatPhoneAudioTime(take.startTime)} · {take.duration.toFixed(2)} s</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
