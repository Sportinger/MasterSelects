// Voiceover on the phone through the editor's own AudioRecordingService (the path the desktop
// toolbar and Audio Mixer use): records from the playhead onto a free audio track (one is added
// inside the sheet's edit session when none is free), and on Stop commits the take as a clip at
// the start time. The take, the added track and the imported file all live in the Audio sheet's
// edit session: Done keeps them as one undo step, Cancel rolls them back. Cancel while recording
// discards the capture without a clip.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Logger } from '../../../services/logger';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { createAudioRecordingTargets, isAudioRecordingActivePhase } from '../../../services/audio/timelineRecordingWorkflow';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneEditSession } from '../sheets/phoneEditSession';
import { findVoiceoverTrackId } from './phoneAudioTimeline';

const log = Logger.create('PhoneVoiceover');

export type PhoneVoiceoverPhase = 'idle' | 'starting' | 'recording' | 'stopping';

export interface PhoneVoiceoverTake {
  clipId: string;
  name: string;
  startTime: number;
  duration: number;
}

export interface PhoneVoiceover {
  phase: PhoneVoiceoverPhase;
  /** Seconds since the capture started (display only). */
  elapsed: number;
  takes: PhoneVoiceoverTake[];
  error: string | null;
  /** Why recording cannot start here at all (no microphone API, another recording runs), or null. */
  unavailableReason: string | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Discards a running capture (no clip). Safe to call when idle. */
  discard: () => Promise<void>;
}

function microphoneUnavailableReason(): string | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'This browser gives the page no microphone here (it needs a secure https address and microphone support).';
  }
  return null;
}

function errorText(error: unknown): string {
  if (error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
    return 'Microphone access was refused. Allow the microphone for this site in the browser settings, then try again.';
  }
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'No microphone was found on this device.';
  return error instanceof Error ? error.message : String(error);
}

export function usePhoneVoiceover(session: PhoneEditSession): PhoneVoiceover {
  const [phase, setPhase] = useState<PhoneVoiceoverPhase>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [takes, setTakes] = useState<PhoneVoiceoverTake[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [otherRecording, setOtherRecording] = useState(false);
  const ownSession = useRef(false);
  const startedAt = useRef(0);

  useEffect(() => audioRecordingService.subscribe((snapshot) => {
    setOtherRecording(!ownSession.current && isAudioRecordingActivePhase(snapshot.phase));
  }), []);

  useEffect(() => {
    if (phase !== 'recording') return undefined;
    // Display only: the take length comes from the recorder, not from this timer.
    const timer = window.setInterval(() => setElapsed((Date.now() - startedAt.current) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [phase]);

  // Leaving the sheet while recording discards the capture; the session rolls back the rest.
  useEffect(() => () => {
    if (ownSession.current) {
      ownSession.current = false;
      void audioRecordingService.cancel().catch((cause) => log.warn('Discarding the voiceover failed', cause));
    }
  }, []);

  const start = useCallback(async () => {
    if (phase !== 'idle') return;
    setError(null);
    setPhase('starting');
    const startTime = useTimelineStore.getState().playheadPosition;
    const prepared: { trackId: string | null } = { trackId: null };
    await session.apply(() => {
      const state = useTimelineStore.getState();
      prepared.trackId = findVoiceoverTrackId(state.tracks, state.clips, startTime) ?? state.addTrack('audio');
    });
    const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === prepared.trackId);
    if (!track) {
      setError('No audio track could be prepared for the voiceover.');
      setPhase('idle');
      return;
    }
    try {
      ownSession.current = true;
      startedAt.current = Date.now();
      setElapsed(0);
      await audioRecordingService.start({
        startTime,
        targets: createAudioRecordingTargets([track]),
        getTimelineTime: () => useTimelineStore.getState().playheadPosition,
      });
      startedAt.current = Date.now();
      log.info('Phone voiceover started', { trackId: track.id, startTime });
      setPhase('recording');
    } catch (cause) {
      ownSession.current = false;
      log.warn('Phone voiceover could not start', cause);
      setError(`Recording could not start: ${errorText(cause)}`);
      setPhase('idle');
    }
  }, [phase, session]);

  const stop = useCallback(async () => {
    if (phase !== 'recording') return;
    setPhase('stopping');
    try {
      const result = await audioRecordingService.stop();
      ownSession.current = false;
      const outcome: { committed: PhoneVoiceoverTake[]; error: string | null } = { committed: [], error: null };
      await session.apply(async () => {
        try {
          const commit = await audioRecordingService.commitRecordingResult(result);
          const clips = useTimelineStore.getState().clips;
          outcome.committed = commit.clips.map((entry) => {
            const clip = clips.find((candidate) => candidate.id === entry.clipId);
            return { clipId: entry.clipId, name: entry.fileName, startTime: clip?.startTime ?? result.startTime, duration: clip?.duration ?? 0 };
          });
        } catch (cause) {
          outcome.error = errorText(cause);
        }
      });
      if (outcome.error) setError(`The take could not be added: ${outcome.error} It stays in the recovery list of the full editor's Audio Mixer.`);
      else if (outcome.committed.length === 0) setError('The recording was empty; no clip was added.');
      setTakes((current) => [...current, ...outcome.committed]);
      log.info('Phone voiceover committed', { clips: outcome.committed.length });
    } catch (cause) {
      ownSession.current = false;
      log.warn('Phone voiceover could not stop', cause);
      setError(`Recording could not be finished: ${errorText(cause)}`);
    } finally {
      setPhase('idle');
    }
  }, [phase, session]);

  const discard = useCallback(async () => {
    if (!ownSession.current) return;
    ownSession.current = false;
    try {
      await audioRecordingService.cancel();
    } catch (cause) {
      log.warn('Discarding the voiceover failed', cause);
    }
    setPhase('idle');
  }, []);

  const unavailableReason = microphoneUnavailableReason()
    ?? (otherRecording ? 'Another recording is running in this project. Stop it first.' : null);

  return { phase, elapsed, takes, error, unavailableReason, start, stop, discard };
}
