// Punch recording on the phone: records only between a punch-in and a punch-out time, through the
// editor's AudioRecordingService punch path (the desktop record button with in/out points). Start
// seeks to a short pre-roll before punch-in and plays; the service arms itself, starts capturing at
// punch-in and stops at punch-out on its own, then the take is committed inside the Audio sheet's
// edit session (Done keeps it as one undo step, Cancel removes it). The punch range defaults to the
// timeline's in/out points when set.

import { useCallback, useEffect, useRef, useState } from 'react';

import { Logger } from '../../../services/logger';
import { audioRecordingService } from '../../../services/audio/AudioRecordingService';
import { createAudioRecordingTargets, isAudioRecordingActivePhase } from '../../../services/audio/timelineRecordingWorkflow';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';
import { useTimelineStore } from '../../../stores/timeline';
import type { AudioRecordingPhase } from '../../../types/audio';
import type { PhoneEditSession } from '../sheets/phoneEditSession';
import { findVoiceoverTrackId } from './phoneAudioTimeline';
import type { PhoneVoiceoverTake } from './usePhoneVoiceover';

const log = Logger.create('PhonePunchRecording');

/** Seconds of playback before punch-in (the microphone warms up meanwhile). */
export const PHONE_PUNCH_PREROLL_SECONDS = 1;
const MIN_PUNCH_SECONDS = 0.1;

export type PhonePunchPhase = 'idle' | 'starting' | AudioRecordingPhase;

export interface PhonePunchRecording {
  punchIn: number;
  punchOut: number;
  setPunchIn: (value: number) => void;
  setPunchOut: (value: number) => void;
  phase: PhonePunchPhase;
  /** True while this hook's punch session runs (waiting, warming, recording, stopping). */
  active: boolean;
  takes: PhoneVoiceoverTake[];
  error: string | null;
  /** Why the range cannot record (empty or reversed range), or null. */
  rangeProblem: string | null;
  start: () => Promise<void>;
  /** Stops early (keeps what was recorded) or discards when still waiting. */
  stop: () => Promise<void>;
  discard: () => Promise<void>;
}

function livePlayhead(): number {
  return getPlayheadPosition(useTimelineStore.getState().playheadPosition);
}

export function resolvePhonePunchProblem(punchIn: number, punchOut: number): string | null {
  if (!Number.isFinite(punchIn) || !Number.isFinite(punchOut) || punchIn < 0) return 'Type a punch-in and punch-out time in seconds.';
  if (punchOut - punchIn < MIN_PUNCH_SECONDS) return 'Punch-out must be at least 0.1 s after punch-in.';
  return null;
}

export function usePhonePunchRecording(session: PhoneEditSession): PhonePunchRecording {
  const [punchIn, setPunchIn] = useState(() => {
    const state = useTimelineStore.getState();
    return state.inPoint ?? state.playheadPosition;
  });
  const [punchOut, setPunchOut] = useState(() => {
    const state = useTimelineStore.getState();
    return state.outPoint ?? (state.inPoint ?? state.playheadPosition) + 2;
  });
  const [phase, setPhase] = useState<PhonePunchPhase>('idle');
  const [takes, setTakes] = useState<PhoneVoiceoverTake[]>([]);
  const [error, setError] = useState<string | null>(null);
  const ownSession = useRef(false);

  useEffect(() => audioRecordingService.subscribe((snapshot) => {
    if (ownSession.current) setPhase(snapshot.phase);
  }), []);

  useEffect(() => () => {
    if (!ownSession.current) return;
    ownSession.current = false;
    void audioRecordingService.cancel().catch((cause) => log.warn('Discarding the punch recording failed', cause));
  }, []);

  const finishTake = useCallback(async (result: Awaited<ReturnType<typeof audioRecordingService.stop>>) => {
    ownSession.current = false;
    useTimelineStore.getState().pause();
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
        outcome.error = cause instanceof Error ? cause.message : String(cause);
      }
    });
    if (outcome.error) setError(`The take could not be added: ${outcome.error} It stays under Rescue recordings.`);
    else if (outcome.committed.length === 0) setError('The punch range recorded nothing; no clip was added.');
    setTakes((current) => [...current, ...outcome.committed]);
    setPhase('idle');
    log.info('Phone punch take committed', { clips: outcome.committed.length });
  }, [session]);

  const start = useCallback(async () => {
    if (phase !== 'idle') return;
    const problem = resolvePhonePunchProblem(punchIn, punchOut);
    if (problem) { setError(problem); return; }
    setError(null);
    setPhase('starting');
    const timeline = useTimelineStore.getState();
    if (timeline.isPlaying) timeline.pause();
    const prepared: { trackId: string | null } = { trackId: null };
    await session.apply(() => {
      const state = useTimelineStore.getState();
      prepared.trackId = findVoiceoverTrackId(state.tracks, state.clips, punchIn) ?? state.addTrack('audio');
    });
    const track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === prepared.trackId);
    if (!track) {
      setError('No audio track could be prepared for the punch recording.');
      setPhase('idle');
      return;
    }
    useTimelineStore.getState().setPlayheadPosition(Math.max(0, punchIn - PHONE_PUNCH_PREROLL_SECONDS));
    try {
      ownSession.current = true;
      await audioRecordingService.start({
        startTime: punchIn,
        punchInTime: punchIn,
        punchOutTime: punchOut,
        targets: createAudioRecordingTargets([track]),
        getTimelineTime: livePlayhead,
        onPunchOut: finishTake,
      });
      setPhase(audioRecordingService.getSnapshot().phase);
      await useTimelineStore.getState().play();
      log.info('Phone punch recording armed', { trackId: track.id, punchIn, punchOut });
    } catch (cause) {
      ownSession.current = false;
      log.warn('Phone punch recording could not start', cause);
      setError(`Recording could not start: ${cause instanceof Error ? cause.message : String(cause)}`);
      setPhase('idle');
    }
  }, [finishTake, phase, punchIn, punchOut, session]);

  const discard = useCallback(async () => {
    if (!ownSession.current) return;
    ownSession.current = false;
    useTimelineStore.getState().pause();
    try {
      await audioRecordingService.cancel();
    } catch (cause) {
      log.warn('Discarding the punch recording failed', cause);
    }
    setPhase('idle');
  }, []);

  const stop = useCallback(async () => {
    if (!ownSession.current) return;
    const current = audioRecordingService.getSnapshot().phase;
    if (current !== 'recording') { await discard(); return; }
    try {
      await finishTake(await audioRecordingService.stop());
    } catch (cause) {
      log.warn('Stopping the punch recording failed', cause);
      setError(`Recording could not be finished: ${cause instanceof Error ? cause.message : String(cause)}`);
      setPhase('idle');
    }
  }, [discard, finishTake]);

  const active = phase !== 'idle' && (phase === 'starting' || isAudioRecordingActivePhase(phase as AudioRecordingPhase));

  return {
    punchIn, punchOut, setPunchIn, setPunchOut, phase, active, takes, error,
    rangeProblem: resolvePhonePunchProblem(punchIn, punchOut), start, stop, discard,
  };
}
