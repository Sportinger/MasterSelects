// Score editor toolbar — the note-entry palette (issue #366, phase 3).
//
// Port of the kikoromantest toolbar: tool mode, durations, accidentals,
// articulations, dot, triplet mode, tie. Button styling comes from the
// stylesheet ScoreEditor injects into the popup document (pointer focus is
// cleared there; keyboard :focus-visible stays styled). Beaming is fully
// automatic (stock VexFlow) — there is deliberately no beam control.

import { useSyncExternalStore } from 'react';
import type { NoteDuration } from '../../types/scoreClip';
import type { ObservableScoreEditorState } from './scoreEditorState';
import type { ScorePaletteController } from './ScorePaletteController';
import type { ScoreSelectionController } from './ScoreSelectionController';

const DURATIONS: Array<{ value: NoteDuration; glyph: string; title: string }> = [
  { value: 'w', glyph: '𝅝', title: 'Whole note (Numpad 6)' },
  { value: 'h', glyph: '𝅗𝅥', title: 'Half note (Numpad 5)' },
  { value: 'q', glyph: '♩', title: 'Quarter note (Numpad 4)' },
  { value: '8', glyph: '♪', title: 'Eighth note (Numpad 3)' },
  { value: '16', glyph: '𝅘𝅥𝅯', title: 'Sixteenth note (Numpad 2)' },
  { value: '32', glyph: '𝅘𝅥𝅰', title: 'Thirty-second note (Numpad 1)' },
];

interface ScoreToolbarProps {
  observable: ObservableScoreEditorState;
  palette: ScorePaletteController;
  selection: ScoreSelectionController;
  renderScore: () => void;
  clearPreview: () => void;
  zoomBy: (direction: 1 | -1) => void;
  resetZoom: () => void;
}

export function ScoreToolbar({ observable, palette, selection, renderScore, clearPreview, zoomBy, resetZoom }: ScoreToolbarProps) {
  // Re-render on every editor-state change (controllers mutate the proxy)
  useSyncExternalStore(observable.subscribe, observable.getVersion);
  const state = observable.state;

  const btn = (active: boolean) => `se-btn${active ? ' se-btn-active' : ''}`;

  return (
    <div className="se-toolbar">
      <div className="se-group" role="group" aria-label="Tool">
        <button
          type="button"
          className={btn(state.selectedTool === 'entry')}
          title="Note entry tool (N)"
          onClick={() => {
            state.selectedTool = 'entry';
            state.selectedNoteId = null;
            renderScore();
          }}
        >
          Entry
        </button>
        <button
          type="button"
          className={btn(state.selectedTool === 'selection')}
          title="Selection tool (Esc)"
          onClick={() => {
            state.selectedTool = 'selection';
            selection.selectNote(state.selectedNoteId);
            clearPreview();
            renderScore();
          }}
        >
          Select
        </button>
      </div>

      <div className="se-group" role="group" aria-label="Duration">
        {DURATIONS.map(({ value, glyph, title }) => (
          <button
            key={value}
            type="button"
            className={`${btn(state.selectedDuration === value)} se-btn-glyph`}
            title={title}
            onClick={() => palette.setDuration(value)}
          >
            {glyph}
          </button>
        ))}
        <button
          type="button"
          className={btn(state.selectedDots > 0)}
          title="Toggle dot (.)"
          onClick={() => palette.toggleDot()}
        >
          ·
        </button>
      </div>

      <div className="se-group" role="group" aria-label="Accidental">
        <button type="button" className={`${btn(state.selectedAccidental === '#')} se-btn-glyph`} title="Sharp (Numpad 8)" onClick={() => palette.setAccidental('#')}>♯</button>
        <button type="button" className={`${btn(state.selectedAccidental === 'b')} se-btn-glyph`} title="Flat (Numpad 9)" onClick={() => palette.setAccidental('b')}>♭</button>
        <button type="button" className={`${btn(state.selectedAccidental === 'n')} se-btn-glyph`} title="Natural (Numpad 7)" onClick={() => palette.setAccidental('n')}>♮</button>
      </div>

      <div className="se-group" role="group" aria-label="Articulation">
        <button type="button" className={btn(palette.noteHasAccent())} title="Accent (Numpad /)" onClick={() => palette.toggleAccent()}>&gt;</button>
        <button type="button" className={btn(palette.noteHasStaccato())} title="Staccato (Numpad *)" onClick={() => palette.toggleStaccato()}>•</button>
        <button type="button" className={btn(palette.noteHasTenuto())} title="Tenuto (Numpad -)" onClick={() => palette.toggleTenuto()}>—</button>
      </div>

      <div className="se-group" role="group" aria-label="Tuplet and tie">
        <button type="button" className={btn(state.tupletMode)} title="Triplet mode (T)" onClick={() => palette.toggleTuplet()}>3</button>
        <button type="button" className={btn(palette.noteHasTie())} title="Tie to next note (Numpad Enter)" onClick={() => palette.toggleTie()}>⌒</button>
      </div>

      <div className="se-group" role="group" aria-label="Zoom" style={{ marginLeft: 'auto' }}>
        <button type="button" className={btn(false)} title="Zoom out (Ctrl+- / Ctrl+wheel)" onClick={() => zoomBy(-1)}>−</button>
        <button
          type="button"
          className={`${btn(false)} se-zoom-value`}
          title="Reset zoom (Ctrl+0)"
          onClick={() => resetZoom()}
        >
          {Math.round(state.zoom * 100)}%
        </button>
        <button type="button" className={btn(false)} title="Zoom in (Ctrl++ / Ctrl+wheel)" onClick={() => zoomBy(1)}>+</button>
      </div>
    </div>
  );
}
