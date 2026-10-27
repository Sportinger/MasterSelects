// 'score' sheet ("Notation"): the desktop score editor (ScoreEditor, normally a detached window)
// inline for the selected score clip, plus a touch bar for everything the desktop does with the
// keyboard: letter notes, chord notes, rest, delete, pitch and octave, previous/next note and stem
// direction (the editor's own shortcut actions by name). Its toolbar keeps durations, dot,
// accidentals, articulations, triplets, ties, playback and zoom; tapping the staff enters notes.
// Without a selected score clip it lists the composition's score clips and can add one.
//
// Each note edit is its own undo step in the editor's history, exactly as in the desktop score
// window (the editor commits whole-score data per edit); the sheet therefore only has Close.

import { lazy, Suspense, useState } from 'react';

import type { PhoneSheetComponent } from '../contracts';
import { PhoneSheet } from '../sheets/PhoneSheet';
import { usePhoneUiStore } from '../state/phoneUiStore';
import { useTimelineStore } from '../../../stores/timeline';
import { Logger } from '../../../services/logger';
import { blurAfterPointer } from '../audio/PhoneAudioControls';
import { createPhoneScoreClip, findSelectedPhoneScoreClip } from './phoneScoreModel';
import { PHONE_SCORE_TEST_IDS as IDS } from './phoneScoreTestIds';
import '../audio/PhoneAudioSheets.css';
import './PhoneScore.css';

const ScoreEditor = lazy(() => import('../../scoreEditor/ScoreEditor').then((m) => ({ default: m.ScoreEditor })));

const log = Logger.create('PhoneScoreSheet');

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'] as const;

const MOVES: readonly { action: string; label: string; aria: string }[] = [
  { action: 'selectPreviousNote', label: '◀', aria: 'Previous note' },
  { action: 'selectNextNote', label: '▶', aria: 'Next note' },
  { action: 'pitchUp', label: 'Step ↑', aria: 'Raise one step' },
  { action: 'pitchDown', label: 'Step ↓', aria: 'Lower one step' },
  { action: 'octaveUp', label: 'Oct ↑', aria: 'Raise one octave' },
  { action: 'octaveDown', label: 'Oct ↓', aria: 'Lower one octave' },
  { action: 'chordNoteUp', label: 'Chord ↑', aria: 'Select the next higher note of the chord' },
  { action: 'chordNoteDown', label: 'Chord ↓', aria: 'Select the next lower note of the chord' },
  { action: 'flipStemDirection', label: 'Flip stem', aria: 'Flip the stem direction' },
  { action: 'enterRest', label: 'Rest', aria: 'Enter a rest' },
  { action: 'deleteSelected', label: 'Delete', aria: 'Delete the selected note or mark' },
];

function TouchBar({ runAction }: { runAction: (action: string) => boolean }) {
  const [chord, setChord] = useState(false);
  const run = (action: string) => {
    if (!runAction(action)) log.warn('The score editor has no such action', { action });
  };
  return (
    <div className="phone-score-touch" data-testid={IDS.touchBar}>
      <div className="phone-score-touch__row" role="group" aria-label="Notes">
        {LETTERS.map((letter) => (
          <button key={letter} type="button" className="phone-score-touch__key" data-testid={`${IDS.letterPrefix}${letter}`}
            onPointerUp={blurAfterPointer}
            onClick={() => run(`${chord ? 'addChord' : 'enterNote'}${letter.toUpperCase()}`)}>
            {letter.toUpperCase()}
          </button>
        ))}
        <button type="button" className="phone-score-touch__key" aria-pressed={chord} data-testid={IDS.chordMode}
          onPointerUp={blurAfterPointer} onClick={() => setChord((value) => !value)}>
          + Chord
        </button>
      </div>
      <div className="phone-score-touch__row" role="group" aria-label="Edit">
        {MOVES.map((move) => (
          <button key={move.action} type="button" className="phone-score-touch__key" aria-label={move.aria}
            data-testid={`${IDS.actionPrefix}${move.action}`} onPointerUp={blurAfterPointer} onClick={() => run(move.action)}>
            {move.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export const PhoneScoreSheet: PhoneSheetComponent = () => {
  const closeSheet = usePhoneUiStore((state) => state.closeSheet);
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const [error, setError] = useState<string | null>(null);
  const selected = findSelectedPhoneScoreClip(clips, selectedClipIds);
  const scoreClips = clips.filter((clip) => clip.source?.type === 'score');
  const trackName = (trackId: string) => tracks.find((track) => track.id === trackId)?.name ?? 'Score';

  return (
    <PhoneSheet title="Notation" height="tall" onCancel={closeSheet} cancelLabel="Close">
      <div className="phone-score" data-testid={IDS.root} data-clip-id={selected?.id ?? ''}>
        {selected ? (
          <>
            <p className="phone-audio-sheet__hint" data-testid={IDS.limit}>
              Tap the staff to place a note (Entry), or switch to Select and tap a note to change it. Play and tapped notes sound with the track instrument here; score clips do not sound in the timeline or the export yet (same as the full editor).
            </p>
            <div className="phone-score__editor">
              <Suspense fallback={<p className="phone-audio-sheet__hint">Loading the score editor…</p>}>
                <ScoreEditor clipId={selected.id} touchBar={(runAction) => <TouchBar runAction={runAction} />} />
              </Suspense>
            </div>
          </>
        ) : (
          <div className="phone-audio-section">
            <p className="phone-audio-sheet__target" data-testid={IDS.empty}>Select a score clip to write notes, or add one at the playhead.</p>
            {scoreClips.length > 0 ? (
              <ul className="phone-audio-list">
                {scoreClips.map((clip) => (
                  <li key={clip.id}>
                    <button type="button" className="phone-score__pick" data-testid={IDS.pick} data-clip-id={clip.id}
                      onPointerUp={blurAfterPointer} onClick={() => useTimelineStore.getState().selectClip(clip.id, false)}>
                      <span className="phone-audio-list__name">{clip.name}</span>
                      <span className="phone-audio-list__meta">{trackName(clip.trackId)} · at {clip.startTime.toFixed(1)} s</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <button type="button" className="phone-audio-big" data-testid={IDS.create} onPointerUp={blurAfterPointer}
              onClick={() => { const result = createPhoneScoreClip(); setError(result.error ?? null); }}>
              Add a score clip at the playhead
            </button>
            {error ? <p className="phone-audio-sheet__error" role="alert">{error}</p> : null}
          </div>
        )}
      </div>
    </PhoneSheet>
  );
};
