// Keyboard shortcuts for the score editor popup (issue #366, phase 3).
//
// The complete kikoromantest shortcut table, bound to the POPUP's own
// document (piano-roll precedent — the host's global handlers never fire in
// a detached window). Undo/redo drive the host historyStore directly; the
// editor reloads from clip.scoreData through its store subscription.

import type { ArticulationType } from '../../types/scoreClip';
import { ScoreEditorEngine } from '../../services/score/ScoreEditorEngine';
import { undo as hostUndo, redo as hostRedo } from '../../stores/historyStore';
import type { ScoreEditorState } from './scoreEditorState';
import type { ScoreSelectionController } from './ScoreSelectionController';
import type { ScorePaletteController } from './ScorePaletteController';
import type { ScoreKeyboardController } from './ScoreKeyboardController';
import type { ScoreRenderCoordinator } from './ScoreRenderCoordinator';

interface ShortcutDefinition {
  action: string;
  description?: string;
}

/**
 * Shortcut mappings: key (KeyboardEvent.key, or .code for numpad) → action.
 * Modifier combos are prefixed 'Ctrl+' / 'Shift+' / 'Alt+'.
 */
export const SCORE_SHORTCUTS: Record<string, ShortcutDefinition> = {
  // Tool modes
  'n': { action: 'setEntryMode', description: 'Switch to note entry mode' },
  'Escape': { action: 'setSelectionMode', description: 'Switch to selection mode / clear selection' },
  ' ': { action: 'enterEntryFromSelection', description: 'Enter entry mode keeping the selected note as cursor anchor' },

  // Editing
  'Delete': { action: 'deleteSelected', description: 'Delete selected note or sub-element' },
  'Backspace': { action: 'deleteSelected', description: 'Delete selected note or sub-element' },

  // Durations (numpad — Sibelius style)
  'Numpad1': { action: 'setDurationThirtySecond', description: 'Thirty-second note' },
  'Numpad2': { action: 'setDurationSixteenth', description: 'Sixteenth note' },
  'Numpad3': { action: 'setDurationEighth', description: 'Eighth note' },
  'Numpad4': { action: 'setDurationQuarter', description: 'Quarter note' },
  'Numpad5': { action: 'setDurationHalf', description: 'Half note' },
  'Numpad6': { action: 'setDurationWhole', description: 'Whole note' },

  // Accidentals (numpad)
  'Numpad7': { action: 'setAccidentalNatural', description: 'Natural' },
  'Numpad8': { action: 'setAccidentalSharp', description: 'Sharp' },
  'Numpad9': { action: 'setAccidentalFlat', description: 'Flat' },

  // Tie / articulations (numpad)
  'NumpadEnter': { action: 'toggleTie', description: 'Toggle tie to next note' },
  'NumpadDivide': { action: 'toggleAccent', description: 'Toggle accent' },
  'NumpadMultiply': { action: 'toggleStaccato', description: 'Toggle staccato' },
  'NumpadSubtract': { action: 'toggleTenuto', description: 'Toggle tenuto' },

  // Navigation
  'ArrowRight': { action: 'selectNextNote', description: 'Select next note/rest' },
  'ArrowLeft': { action: 'selectPreviousNote', description: 'Select previous note/rest' },

  // Pitch editing
  'ArrowUp': { action: 'pitchUp', description: 'Raise pitch one step' },
  'ArrowDown': { action: 'pitchDown', description: 'Lower pitch one step' },
  'Ctrl+ArrowUp': { action: 'octaveUp', description: 'Raise one octave' },
  'Ctrl+ArrowDown': { action: 'octaveDown', description: 'Lower one octave' },
  'Alt+ArrowUp': { action: 'chordNoteUp', description: 'Select next higher chord note' },
  'Alt+ArrowDown': { action: 'chordNoteDown', description: 'Select next lower chord note' },

  // Undo/Redo (host history)
  'Ctrl+z': { action: 'undo', description: 'Undo' },
  'Ctrl+Shift+z': { action: 'redo', description: 'Redo' },
  'Ctrl+y': { action: 'redo', description: 'Redo' },

  // Zoom
  'Ctrl+=': { action: 'zoomIn', description: 'Zoom in' },
  'Ctrl++': { action: 'zoomIn', description: 'Zoom in' },
  'Ctrl+Shift++': { action: 'zoomIn', description: 'Zoom in (layouts where + needs Shift)' },
  'Ctrl+-': { action: 'zoomOut', description: 'Zoom out' },
  'Ctrl+0': { action: 'zoomReset', description: 'Reset zoom' },

  // Dot / tuplet / stem
  'Period': { action: 'toggleDot', description: 'Toggle dotted note' },
  'NumpadDecimal': { action: 'toggleDot', description: 'Toggle dotted note (numpad)' },
  't': { action: 'toggleTuplet', description: 'Toggle triplet mode' },
  'Ctrl+3': { action: 'toggleTuplet', description: 'Toggle triplet mode (Ctrl+3)' },
  'x': { action: 'flipStemDirection', description: 'Flip stem direction' },

  // Rest + letter entry
  'r': { action: 'enterRest', description: 'Enter rest at cursor position' },
  'a': { action: 'enterNoteA' }, 'b': { action: 'enterNoteB' }, 'c': { action: 'enterNoteC' },
  'd': { action: 'enterNoteD' }, 'e': { action: 'enterNoteE' }, 'f': { action: 'enterNoteF' },
  'g': { action: 'enterNoteG' },

  // Chord note entry
  'Shift+a': { action: 'addChordA' }, 'Shift+b': { action: 'addChordB' }, 'Shift+c': { action: 'addChordC' },
  'Shift+d': { action: 'addChordD' }, 'Shift+e': { action: 'addChordE' }, 'Shift+f': { action: 'addChordF' },
  'Shift+g': { action: 'addChordG' },
};

type ActionHandler = () => void;

/** Keydown dispatcher bound to a specific (popup) document. */
export class ScoreShortcutManager {
  private handlers = new Map<string, ActionHandler>();
  private enabled = false;
  private doc: Document;
  private readonly boundKeyHandler = (event: KeyboardEvent) => this.handleKeyDown(event);

  constructor(doc: Document) {
    this.doc = doc;
  }

  registerActions(actions: Record<string, ActionHandler>): void {
    for (const [action, handler] of Object.entries(actions)) {
      this.handlers.set(action, handler);
    }
  }

  enable(): void {
    if (!this.enabled) {
      this.doc.addEventListener('keydown', this.boundKeyHandler);
      this.enabled = true;
    }
  }

  disable(): void {
    if (this.enabled) {
      this.doc.removeEventListener('keydown', this.boundKeyHandler);
      this.enabled = false;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    // Never steal keys from an editable field
    const target = event.target as HTMLElement | null;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;

    const modifiers: string[] = [];
    if (event.ctrlKey || event.metaKey) modifiers.push('Ctrl');
    if (event.shiftKey) modifiers.push('Shift');
    if (event.altKey) modifiers.push('Alt');
    const modifierPrefix = modifiers.length > 0 ? modifiers.join('+') + '+' : '';

    // Lowercase letters so caps lock doesn't break Ctrl+Z etc.
    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

    let shortcut: ShortcutDefinition | undefined;
    if (modifierPrefix) {
      // Modifier combos match event.key only (so Ctrl+ArrowUp ≠ numpad arrows)
      shortcut = SCORE_SHORTCUTS[modifierPrefix + key];
    } else {
      // Plain keys check code first (numpad) then key
      shortcut = SCORE_SHORTCUTS[event.code] || SCORE_SHORTCUTS[event.key];
    }
    if (!shortcut) return;

    const handler = this.handlers.get(shortcut.action);
    if (!handler) return;

    event.preventDefault();
    handler();
  }
}

/**
 * Wire the complete shortcut table to the controllers. Returns the manager
 * (enable on mount, disable on unmount).
 */
export function createScoreShortcuts(
  doc: Document,
  state: ScoreEditorState,
  getEngine: () => ScoreEditorEngine | null,
  selection: ScoreSelectionController,
  palette: ScorePaletteController,
  keyboard: ScoreKeyboardController,
  renderer: ScoreRenderCoordinator,
  getLastMousePosition: () => { x: number; y: number } | null,
): ScoreShortcutManager {
  const manager = new ScoreShortcutManager(doc);

  manager.registerActions({
    setEntryMode: () => {
      state.selectedTool = 'entry';
      state.selectedNoteId = null;
      palette.resetToDefaults();
      const pos = getLastMousePosition();
      if (pos) renderer.renderPreview(pos);
      renderer.renderScore();
    },
    enterEntryFromSelection: () => {
      if (state.selectedTool !== 'selection' || !state.selectedNoteId) return;
      state.selectedTool = 'entry';
      renderer.renderScore();
    },
    setSelectionMode: () => {
      if (state.selectedTool === 'entry') {
        state.selectedTool = 'selection';
        selection.selectNote(state.selectedNoteId);
        renderer.clearPreview();
        renderer.renderScore();
      } else if (state.selectedTool === 'selection' && state.selectedNoteId) {
        selection.selectNote(null);
        renderer.renderScore();
      } else {
        state.selectedTool = 'selection';
        renderer.renderScore();
      }
    },
    // Delete priority chain: articulation → accidental → tie → tuplet → note
    deleteSelected: () => {
      const engine = getEngine();
      if (!engine) return;
      if (state.selectedArticulationNoteId && state.selectedArticulationType) {
        const noteId = state.selectedArticulationNoteId;
        engine.toggleArticulation(noteId, state.selectedArticulationType as ArticulationType);
        state.selectedArticulationNoteId = null;
        state.selectedArticulationType = null;
        selection.selectNote(noteId);
        renderer.renderScore();
      } else if (state.selectedAccidentalNoteId) {
        const noteId = state.selectedAccidentalNoteId;
        engine.updateNote(noteId, { forceAccidental: undefined });
        state.selectedAccidentalNoteId = null;
        state.selectedAccidentalType = null;
        selection.selectNote(noteId);
        renderer.renderScore();
      } else if (state.selectedTieFromNoteId) {
        engine.toggleTie(state.selectedTieFromNoteId);
        state.selectedTieFromNoteId = null;
        renderer.renderScore();
      } else if (state.selectedTupletId) {
        engine.deleteTuplet(state.selectedTupletId);
        state.selectedTupletId = null;
        renderer.renderScore();
      } else if (state.selectedNoteId) {
        engine.deleteNote(state.selectedNoteId);
        selection.selectNote(null);
        renderer.renderScore();
      }
    },
    setDurationThirtySecond: () => palette.setDuration('32'),
    setDurationSixteenth: () => palette.setDuration('16'),
    setDurationEighth: () => palette.setDuration('8'),
    setDurationQuarter: () => palette.setDuration('q'),
    setDurationHalf: () => palette.setDuration('h'),
    setDurationWhole: () => palette.setDuration('w'),
    setAccidentalNatural: () => palette.setAccidental('n'),
    setAccidentalSharp: () => palette.setAccidental('#'),
    setAccidentalFlat: () => palette.setAccidental('b'),
    toggleAccent: () => palette.toggleAccent(),
    toggleStaccato: () => palette.toggleStaccato(),
    toggleTenuto: () => palette.toggleTenuto(),
    toggleTie: () => palette.toggleTie(),
    selectNextNote: () => {
      if (state.selectedTool === 'entry') {
        state.selectedTool = 'selection';
      }
      selection.navigateSelection(1);
    },
    selectPreviousNote: () => {
      if (state.selectedTool === 'entry') {
        state.selectedTool = 'selection';
        renderer.renderScore();
      } else {
        selection.navigateSelection(-1);
      }
    },
    chordNoteUp: () => selection.navigateChord(1),
    chordNoteDown: () => selection.navigateChord(-1),
    pitchUp: () => selection.adjustPitch(1),
    pitchDown: () => selection.adjustPitch(-1),
    octaveUp: () => selection.adjustOctave(1),
    octaveDown: () => selection.adjustOctave(-1),
    // Host history owns undo/redo; the editor reloads via its store watcher
    undo: () => { hostUndo(); },
    redo: () => { hostRedo(); },
    zoomIn: () => renderer.zoomBy(1),
    zoomOut: () => renderer.zoomBy(-1),
    zoomReset: () => renderer.resetZoom(),
    flipStemDirection: () => {
      const engine = getEngine();
      if (!engine || !state.selectedNoteId) return;
      engine.flipStemDirection(state.selectedNoteId);
      renderer.renderScore();
    },
    toggleDot: () => palette.toggleDot(),
    toggleTuplet: () => palette.toggleTuplet(),
    enterNoteA: () => keyboard.enterNoteByLetter('a'),
    enterNoteB: () => keyboard.enterNoteByLetter('b'),
    enterNoteC: () => keyboard.enterNoteByLetter('c'),
    enterNoteD: () => keyboard.enterNoteByLetter('d'),
    enterNoteE: () => keyboard.enterNoteByLetter('e'),
    enterNoteF: () => keyboard.enterNoteByLetter('f'),
    enterNoteG: () => keyboard.enterNoteByLetter('g'),
    enterRest: () => keyboard.enterRestAtCursorPosition(),
    addChordA: () => keyboard.addChordNoteByLetter('a'),
    addChordB: () => keyboard.addChordNoteByLetter('b'),
    addChordC: () => keyboard.addChordNoteByLetter('c'),
    addChordD: () => keyboard.addChordNoteByLetter('d'),
    addChordE: () => keyboard.addChordNoteByLetter('e'),
    addChordF: () => keyboard.addChordNoteByLetter('f'),
    addChordG: () => keyboard.addChordNoteByLetter('g'),
  });

  return manager;
}
