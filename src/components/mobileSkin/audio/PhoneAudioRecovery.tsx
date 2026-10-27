// "Rescue recordings" in the Audio sheet's Voiceover tab: takes the editor's AudioRecordingService
// kept after an interrupted recording (page closed, reload, crash, or a take that could not be
// added) are listed with time, tracks, length and status; Add puts one on its tracks as its own
// committed undo step, outside the sheet's cancellable session (phoneRecordingRescue: Cancel or a
// blur must never lose a take whose stored audio the service already consumed), Discard
// deletes it after a second tap. Storage warnings of the recorder and the browser's storage
// estimate are shown so a full phone is visible before recording.

import { useEffect, useState } from 'react';

import { Logger } from '../../../services/logger';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import type { AudioRecordingRecoveryEntry, AudioRecordingState } from '../../../types/audio';
import type { PhoneEditSession } from '../sheets/phoneEditSession';
import { blurAfterPointer } from './PhoneAudioControls';
import { formatPhoneAudioTime } from './phoneAudioTimeline';
import { PHONE_AUDIO_TEST_IDS as IDS } from './phoneAudioTestIds';
import { rescuablePhoneRecoveryEntries } from './phoneRecordingModel';
import { rescuePhoneRecording } from './phoneRecordingRescue';

const log = Logger.create('PhoneAudioRecovery');

function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes)) return '?';
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  return `${Math.round(bytes / 1e6)} MB`;
}

function entryLength(entry: AudioRecordingRecoveryEntry): number {
  return Math.max(0, ...(entry.assets ?? []).map((asset) => asset.duration));
}

export function PhoneAudioRecovery({ session, busy }: { session: PhoneEditSession; busy: boolean }) {
  const [snapshot, setSnapshot] = useState<AudioRecordingState>(() => audioRecordingService.getSnapshot());
  const [working, setWorking] = useState<string | null>(null);
  const [armedDiscard, setArmedDiscard] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' } | null>(null);
  const [estimate, setEstimate] = useState<{ usage?: number; quota?: number } | null>(null);

  useEffect(() => audioRecordingService.subscribe(setSnapshot), []);
  useEffect(() => {
    let alive = true;
    void navigator.storage?.estimate?.().then((value) => { if (alive) setEstimate({ usage: value.usage, quota: value.quota }); })
      .catch((error) => log.warn('Storage estimate unavailable', error));
    return () => { alive = false; };
  }, []);

  const entries = rescuablePhoneRecoveryEntries(snapshot, snapshot.recoveryEntries ?? audioRecordingService.listRecoveryEntries());
  const warnings = snapshot.storageWarnings ?? [];

  const add = async (entry: AudioRecordingRecoveryEntry) => {
    if (busy || working) return;
    setMessage(null);
    setWorking(entry.sessionId);
    const outcome = await rescuePhoneRecording(session, entry.sessionId);
    setWorking(null);
    if (outcome.kind === 'needs-done') {
      setMessage({ text: 'Tap Done first to keep this sheet\'s changes, then rescue the recording. A rescued take is kept as its own undo step, so Cancel cannot lose it.', tone: 'error' });
    } else if (outcome.kind === 'failed') {
      log.warn('Rescuing a kept recording failed', outcome.message);
      setMessage({ text: `The recording could not be rescued: ${outcome.message}`, tone: 'error' });
    } else if (outcome.kind === 'already-added') setMessage({ text: 'This recording was already added; nothing was added twice.', tone: 'info' });
    else if (outcome.kind === 'rescued') setMessage({ text: `Rescued: ${outcome.clips} clip${outcome.clips === 1 ? '' : 's'} at ${formatPhoneAudioTime(entry.startTime)}. Kept as its own undo step.`, tone: 'info' });
  };

  const discard = async (entry: AudioRecordingRecoveryEntry) => {
    if (armedDiscard !== entry.sessionId) { setArmedDiscard(entry.sessionId); return; }
    setArmedDiscard(null);
    try {
      await audioRecordingService.dismissRecoveryEntry(entry.sessionId);
      setMessage({ text: 'The kept recording was deleted.', tone: 'info' });
    } catch (error) {
      log.warn('Discarding a kept recording failed', error);
      setMessage({ text: `Deleting failed: ${error instanceof Error ? error.message : String(error)}`, tone: 'error' });
    }
  };

  return (
    <div className="phone-audio-recovery" role="group" aria-label="Rescue recordings" data-testid={IDS.recovery}>
      <span className="phone-audio-more__heading">Rescue recordings</span>
      {entries.length === 0 ? (
        <p className="phone-audio-sheet__hint" data-testid={IDS.recoveryEmpty}>No interrupted recordings are waiting. If the page closes while you record, the take can be rescued here.</p>
      ) : (
        <ul className="phone-audio-list">
          {entries.map((entry) => {
            const canAdd = (entry.status === 'stopped' || entry.status === 'active') && ((entry.assets?.length ?? 0) > 0 || (entry.chunks?.length ?? 0) > 0);
            return (
              <li key={entry.sessionId} className="phone-audio-recovery__item" data-testid={IDS.recoveryItem} data-status={entry.status} data-session-id={entry.sessionId}>
                <span className="phone-audio-list__name">{entry.status === 'active' ? 'Interrupted while recording' : entry.status === 'stopped' ? 'Stopped, not added' : entry.status}</span>
                <span className="phone-audio-list__meta">
                  at {formatPhoneAudioTime(entry.startTime)}{entry.punchOutTime !== undefined ? ` – ${formatPhoneAudioTime(entry.punchOutTime)}` : ''}
                  {entryLength(entry) > 0 ? ` · ${entryLength(entry).toFixed(1)} s` : ''} · {entry.targetTrackIds.length} track{entry.targetTrackIds.length === 1 ? '' : 's'}
                  {entry.message ? ` · ${entry.message}` : ''}
                </span>
                <span className="phone-audio-recovery__actions">
                  <button type="button" className="phone-audio-toggle" data-testid={IDS.recoveryAdd} aria-disabled={!canAdd || busy || working !== null || undefined}
                    onPointerUp={blurAfterPointer}
                    onClick={() => {
                      if (!canAdd) { setMessage({ text: 'Nothing of this recording was saved, so it cannot be added. Discard it.', tone: 'error' }); return; }
                      void add(entry);
                    }}>
                    {working === entry.sessionId ? 'Adding…' : 'Add to timeline'}
                  </button>
                  <button type="button" className="phone-audio-toggle" data-testid={IDS.recoveryDiscard} aria-pressed={armedDiscard === entry.sessionId}
                    onPointerUp={blurAfterPointer} onClick={() => { void discard(entry); }}>
                    {armedDiscard === entry.sessionId ? 'Tap again to delete' : 'Discard'}
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {message ? (
        <p className={message.tone === 'error' ? 'phone-audio-sheet__error' : 'phone-audio-sheet__hint'} role={message.tone === 'error' ? 'alert' : 'status'}
          data-testid={IDS.recoveryMessage}>{message.text}</p>
      ) : null}
      <p className="phone-audio-sheet__hint" data-testid={IDS.recoveryStorage}>
        {estimate?.quota ? `Storage: ${formatBytes(estimate.usage)} of ${formatBytes(estimate.quota)} used.` : 'This browser does not report its storage space.'}
      </p>
      {warnings.map((warning) => (
        <p key={warning.code} className={warning.severity === 'warning' ? 'phone-audio-sheet__error' : 'phone-audio-sheet__hint'} data-testid={IDS.recoveryWarning}>
          {warning.message}
        </p>
      ))}
    </div>
  );
}
