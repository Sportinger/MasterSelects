// The piano roll on the phone (M4): on the desktop it opens in its own window (PianoRollBoot); here
// the same PianoRoll component renders inline in the landscape editor for the selected MIDI clip.
// Without a selected MIDI clip it says so, lists the MIDI clips of the composition to pick from and
// offers to create one at the playhead (on the first MIDI track, adding one when there is none).

import { useState } from 'react';

import { Logger } from '../../../services/logger';
import { useTimelineStore } from '../../../stores/timeline';
import { PianoRoll } from '../../pianoRoll/PianoRoll';
import { PHONE_PIANO_ROLL_TEST_IDS as IDS } from './phonePianoRollTestIds';
import './PhonePianoRollView.css';

const log = Logger.create('PhonePianoRoll');
const NEW_CLIP_SECONDS = 4;

function formatTime(seconds: number): string {
  const whole = Math.max(0, seconds);
  const minutes = Math.floor(whole / 60);
  return `${minutes}:${(whole - minutes * 60).toFixed(1).padStart(4, '0')}`;
}

/** Creates a MIDI clip at the playhead and selects it; returns its id or null (and says why). */
export function createPhoneMidiClip(): { clipId: string | null; error?: string } {
  const store = useTimelineStore.getState();
  let track = store.tracks.find((candidate) => candidate.type === 'midi');
  const trackId = track?.id ?? store.addTrack('midi');
  track = useTimelineStore.getState().tracks.find((candidate) => candidate.id === trackId);
  if (!track) {
    log.warn('No MIDI track could be created for a new MIDI clip');
    return { clipId: null, error: 'No MIDI track could be created.' };
  }
  const clipId = useTimelineStore.getState().addMidiClip(track.id, store.playheadPosition, NEW_CLIP_SECONDS);
  if (!clipId) {
    log.warn('addMidiClip refused a new MIDI clip', { trackId: track.id });
    return { clipId: null, error: 'The MIDI clip could not be created (see the log).' };
  }
  useTimelineStore.getState().selectClip(clipId, false);
  return { clipId };
}

export function PhonePianoRollView() {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const [error, setError] = useState<string | null>(null);

  const midiClips = clips.filter((clip) => clip.source?.type === 'midi');
  const selected = midiClips.find((clip) => selectedClipIds.has(clip.id));

  if (selected) {
    return (
      <div className="phone-piano-roll" data-testid={IDS.root} data-clip-id={selected.id}>
        <PianoRoll clipId={selected.id} embedded />
      </div>
    );
  }

  const trackName = (trackId: string) => tracks.find((track) => track.id === trackId)?.name ?? 'MIDI';
  return (
    <div className="phone-piano-roll phone-piano-roll--empty" data-testid={IDS.empty}>
      <p className="phone-piano-roll__message">
        The piano roll edits the notes of one MIDI clip. Select a MIDI clip on the timeline
        {midiClips.length > 0 ? ', pick one below,' : ''} or create a new one at the playhead.
      </p>
      {midiClips.length > 0 ? (
        <ul className="phone-piano-roll__list">
          {midiClips.toSorted((a, b) => a.startTime - b.startTime).map((clip) => (
            <li key={clip.id}>
              <button
                type="button"
                className="phone-piano-roll__button"
                data-testid={`${IDS.pick}-${clip.id}`}
                onClick={() => useTimelineStore.getState().selectClip(clip.id, false)}
                onPointerUp={(event) => event.currentTarget.blur()}
              >
                {clip.name || 'MIDI Clip'} · {trackName(clip.trackId)} · {formatTime(clip.startTime)} · {clip.midiData?.notes.length ?? 0} notes
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="phone-piano-roll__button phone-piano-roll__button--primary"
        data-testid={IDS.create}
        onClick={() => setError(createPhoneMidiClip().error ?? null)}
        onPointerUp={(event) => event.currentTarget.blur()}
      >
        New MIDI clip at the playhead
      </button>
      {error ? <p className="phone-piano-roll__error" role="alert">{error}</p> : null}
    </div>
  );
}
