// 'audio' sheet (root scope): add music or sound effects from the device at the playhead, record
// a voiceover from the playhead, and extract the sound of the video clip under the playhead into
// its own clip. Beat markers are visible but greyed (they come with M3). Everything happens live
// inside ONE phone edit session: Done keeps all of it as one undo step, Cancel removes all of it.

import { useRef, useState, type ChangeEvent } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneEditSession } from '../sheets/phoneEditSession';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../../services/logger';
import { usePhoneMediaImport } from '../media/usePhoneMediaImport';
import { placePhoneMedia } from '../media/phoneMediaPlacement';
import { blurAfterPointer, PhoneUnavailableList, type PhoneUnavailableItem } from './PhoneAudioControls';
import { formatPhoneAudioTime, resolvePhoneExtractTarget, type PhoneExtractTarget } from './phoneAudioTimeline';
import { usePhoneVoiceover } from './usePhoneVoiceover';
import { PHONE_AUDIO_TEST_IDS as IDS } from './phoneAudioTestIds';
import './PhoneAudioSheets.css';

const log = Logger.create('PhoneAudioSheet');

type Section = 'music' | 'record' | 'extract' | 'beats';

const SECTIONS: readonly { id: Section; label: string }[] = [
  { id: 'music', label: 'Music & sounds' },
  { id: 'record', label: 'Voiceover' },
  { id: 'extract', label: 'Extract audio' },
  { id: 'beats', label: 'Beats' },
];

const BEATS_REASON = 'Beat detection and beat markers come to the phone with milestone M3. The full editor already detects beats (Properties, Analysis) and lines clips up on them with beat rules: tap the project name, then Full editor.';

const MORE: readonly PhoneUnavailableItem[] = [
  { id: 'tracks', label: 'Audio tracks', reason: 'Naming, ordering, solo and mute of audio tracks are not on the phone yet. Use the full editor meanwhile: tap the project name, then Full editor.' },
  { id: 'devices', label: 'Microphone choice', reason: 'The phone records from the default microphone. Choosing another input is in the full editor: Settings, Audio.' },
];

interface MusicEntry {
  name: string;
  startTime: number;
  duration: number;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export const PhoneAudioSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const showToast = usePhoneUiStore((state) => state.showToast);
  const showUnavailable = usePhoneUiStore((state) => state.showUnavailable);
  const session = usePhoneEditSession('Add audio');
  const voiceover = usePhoneVoiceover(session);
  const { progress, importFiles } = usePhoneMediaImport();
  const musicInputRef = useRef<HTMLInputElement>(null);
  const playhead = useTimelineStore((state) => state.playheadPosition);
  const [section, setSection] = useState<Section>('music');
  const [music, setMusic] = useState<MusicEntry[]>([]);
  const [importing, setImporting] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [extracted, setExtracted] = useState<PhoneExtractTarget | null>(null);
  const [closing, setClosing] = useState(false);
  // Resolved on every render: the playhead subscription and this sheet's own changes re-render it.
  const timelineNow = useTimelineStore.getState();
  const extract = resolvePhoneExtractTarget(timelineNow.tracks, timelineNow.clips, [...timelineNow.selectedClipIds], playhead);

  const recording = voiceover.phase !== 'idle';
  const busy = importing || recording || closing;

  const onMusicChosen = (event: ChangeEvent<HTMLInputElement>) => {
    const files = [...(event.target.files ?? [])];
    event.target.value = '';
    if (files.length === 0 || busy) return;
    setImporting(true);
    setProblems([]);
    const outcome: { entries: MusicEntry[]; problems: string[] } = { entries: [], problems: [] };
    void session.apply(async () => {
      try {
        const imported = await importFiles(files);
        const placed = await placePhoneMedia(imported.imported, 'overlay');
        const clips = useTimelineStore.getState().clips;
        outcome.entries = placed.clipIds.flatMap((clipId) => {
          const clip = clips.find((candidate) => candidate.id === clipId);
          return clip ? [{ name: clip.name, startTime: clip.startTime, duration: clip.duration }] : [];
        });
        outcome.problems = [...imported.failures, ...placed.failures, ...imported.notDurable].map((problem) => problem.message);
      } catch (error) {
        log.error('Adding music failed', error);
        outcome.problems = [`Adding the sound failed: ${errorText(error)}.`];
      }
    }).then(() => {
      setMusic((current) => [...current, ...outcome.entries]);
      setProblems(outcome.problems);
      setImporting(false);
    });
  };

  const runExtract = () => {
    if (busy || extract.kind !== 'ready') return;
    const target = extract.target;
    const outcome: { ok: boolean } = { ok: false };
    void session.apply(() => {
      useTimelineStore.getState().unlinkClips([target.videoClipId]);
      const video = useTimelineStore.getState().clips.find((clip) => clip.id === target.videoClipId);
      outcome.ok = video !== undefined && video.linkedClipId !== target.audioClipId;
    }).then(() => {
      if (outcome.ok) setExtracted(target);
      else setProblems([`The audio of ${target.name} could not be separated (is its track locked?).`]);
    });
  };

  const done = async () => {
    if (busy) {
      showToast(recording ? 'Stop the recording first.' : 'Adding audio is in progress. Wait until it finishes.');
      return;
    }
    if (!session.changed) {
      session.cancel();
      closeSheet();
      return;
    }
    setClosing(true);
    const result = await session.commit();
    closeSheet();
    if (!result.ok) showToast(result.message, 'error');
  };

  const cancel = () => {
    if (importing || closing) {
      showToast('Adding audio is in progress. Wait until it finishes.');
      return;
    }
    void voiceover.discard().then(() => {
      session.cancel();
      closeSheet();
    });
  };

  const selectSection = (next: Section) => {
    if (next === 'beats') {
      showUnavailable({ actionId: 'audio-beats', label: 'Beats', reason: BEATS_REASON });
      return;
    }
    if (recording) {
      showToast('Stop the recording first.');
      return;
    }
    setSection(next);
  };

  const status = recording
    ? `Recording from ${formatPhoneAudioTime(useTimelineStore.getState().playheadPosition)}`
    : `Playhead ${formatPhoneAudioTime(playhead)} · new sound starts here`;

  return (
    <PhoneSheet title="Audio" height="tall" onCancel={cancel} onDone={() => { void done(); }} doneDisabled={busy}>
      <div className="phone-audio-sheet">
        <div className="phone-audio-tabs" role="tablist" aria-label="Audio tools">
          {SECTIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              className="phone-audio-tabs__tab"
              aria-selected={section === item.id}
              aria-disabled={item.id === 'beats' || undefined}
              data-testid={`${IDS.sectionPrefix}${item.id}`}
              onPointerUp={blurAfterPointer}
              onClick={() => selectSection(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <p className="phone-audio-sheet__status" data-testid={IDS.status}>{status}</p>

        {section === 'music' ? (
          <div className="phone-audio-section" role="tabpanel" aria-label="Music & sounds">
            <button
              type="button"
              className="phone-audio-big"
              data-testid={IDS.musicPick}
              aria-disabled={busy || undefined}
              onPointerUp={blurAfterPointer}
              onClick={() => { if (!busy) musicInputRef.current?.click(); }}
            >
              {importing ? 'Adding…' : 'Pick music or a sound'}
            </button>
            <input ref={musicInputRef} type="file" accept="audio/*" multiple hidden tabIndex={-1}
              data-testid={IDS.musicInput} onChange={onMusicChosen} />
            <p className="phone-audio-sheet__hint">
              {importing && progress ? `Importing ${progress.index + 1} of ${progress.total}: ${progress.name}` : 'The sound is copied into the project and starts at the playhead on a free audio track.'}
            </p>
            {music.length > 0 ? (
              <ul className="phone-audio-list">
                {music.map((entry, index) => (
                  <li key={`${entry.name}-${index}`} className="phone-audio-list__item" data-testid={IDS.musicItem}>
                    <span className="phone-audio-list__name">{entry.name}</span>
                    <span className="phone-audio-list__meta">at {formatPhoneAudioTime(entry.startTime)} · {entry.duration.toFixed(1)} s</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {section === 'record' ? (
          <div className="phone-audio-section" role="tabpanel" aria-label="Voiceover">
            {voiceover.phase === 'recording' || voiceover.phase === 'stopping' ? (
              <button
                type="button"
                className="phone-audio-big phone-audio-big--recording"
                data-testid={IDS.recordStop}
                aria-disabled={voiceover.phase === 'stopping' || undefined}
                onPointerUp={blurAfterPointer}
                onClick={() => { void voiceover.stop(); }}
              >
                {voiceover.phase === 'stopping' ? 'Saving the take…' : 'Stop'}
                <span className="phone-audio-big__timer" data-testid={IDS.recordTimer}>{voiceover.elapsed.toFixed(1)} s</span>
              </button>
            ) : (
              <button
                type="button"
                className="phone-audio-big"
                data-testid={IDS.recordStart}
                aria-disabled={Boolean(voiceover.unavailableReason) || importing || voiceover.phase === 'starting' || undefined}
                onPointerUp={blurAfterPointer}
                onClick={() => {
                  if (voiceover.unavailableReason) {
                    showUnavailable({ actionId: 'audio-record', label: 'Voiceover', reason: voiceover.unavailableReason });
                    return;
                  }
                  if (!importing) void voiceover.start();
                }}
              >
                {voiceover.phase === 'starting' ? 'Starting the microphone…' : 'Record from the playhead'}
              </button>
            )}
            <p className="phone-audio-sheet__hint">The take lands on a free audio track from where the recording started. Cancel throws every take of this sheet away.</p>
            {voiceover.error ? <p className="phone-audio-sheet__error" role="alert">{voiceover.error}</p> : null}
            {voiceover.takes.length > 0 ? (
              <ul className="phone-audio-list">
                {voiceover.takes.map((take) => (
                  <li key={take.clipId} className="phone-audio-list__item" data-testid={IDS.recordTake}>
                    <span className="phone-audio-list__name">{take.name}</span>
                    <span className="phone-audio-list__meta">at {formatPhoneAudioTime(take.startTime)} · {take.duration.toFixed(1)} s</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {section === 'extract' ? (
          <div className="phone-audio-section" role="tabpanel" aria-label="Extract audio">
            <p className="phone-audio-sheet__target" data-testid={IDS.extractTarget}>
              {extracted
                ? `The sound of ${extracted.name} is now its own clip: move, trim or delete it without the picture.`
                : extract.kind === 'ready' ? `Video under the playhead: ${extract.target.name}` : extract.reason}
            </p>
            <button
              type="button"
              className="phone-audio-big"
              data-testid={IDS.extractRun}
              aria-disabled={extract.kind !== 'ready' || busy || undefined}
              onPointerUp={blurAfterPointer}
              onClick={() => {
                if (extract.kind !== 'ready') {
                  showUnavailable({ actionId: 'audio-extract', label: 'Extract audio', reason: extracted ? 'This clip\'s sound is already separate.' : extract.reason });
                  return;
                }
                runExtract();
              }}
            >
              Extract audio
            </button>
          </div>
        ) : null}

        {problems.length > 0 ? (
          <ul className="phone-audio-sheet__problems" role="alert">
            {problems.map((problem, index) => <li key={`${index}-${problem}`}>{problem}</li>)}
          </ul>
        ) : null}

        <PhoneUnavailableList items={MORE} testIdPrefix={IDS.unavailablePrefix} heading="More audio tools" />
      </div>
    </PhoneSheet>
  );
};
