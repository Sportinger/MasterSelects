// Piano-roll tool shortcuts (#249).
//
// FORWARD-LOOKING DESIGN. These bindings are intentionally modeled on the app's
// central shortcut system (`src/services/shortcutRegistry.ts`): they use the same
// `KeyCombo` shape and the same `matchesCombo` matcher, so there is no parallel
// key-matching logic to drift. They are kept as a small LOCAL table for now only
// because piano-roll tools are not yet exposed in the Shortcuts settings UI.
//
// When piano-roll tools should become user-customizable, the migration is purely
// mechanical and touches no UI:
//   1. Add 'pianoRoll.toolPointer' | 'pianoRoll.toolEraser' | 'pianoRoll.toolSelect'
//      to `ShortcutActionId`, with `ShortcutActionMeta` entries (a 'Piano Roll'
//      category, or reuse 'Tools').
//   2. Add their default combos (below) to every preset in `shortcutPresets.ts`.
//   3. Replace the body of `resolvePianoRollToolAction` with a loop over
//      `getShortcutRegistry().matches(actionId, e)`.
// `resolvePianoRollToolAction` is the single seam between key events and tool
// changes, so callers never change.

import { matchesCombo } from '../../services/shortcutRegistry';
import type { KeyCombo } from '../../services/shortcutTypes';

export type PianoRollToolId = 'pointer' | 'eraser' | 'select';

// Mirrors the registry's dotted ShortcutActionId convention so these slot in
// unchanged once added to the central union.
export type PianoRollToolAction =
  | 'pianoRoll.toolPointer'
  | 'pianoRoll.toolEraser'
  | 'pianoRoll.toolSelect';

export const PIANO_ROLL_TOOL_BY_ACTION: Record<PianoRollToolAction, PianoRollToolId> = {
  'pianoRoll.toolPointer': 'pointer',
  'pianoRoll.toolEraser': 'eraser',
  'pianoRoll.toolSelect': 'select',
};

// Default bindings: plain number keys, no modifier. This matches how both
// FL Studio (unmodified letters) and Cubase (unmodified 1-9) switch tools.
// Combos are arrays, so alternate bindings are already supported, and any held
// Ctrl/Alt/Shift makes `matchesCombo` miss — so chorded number keys fall through
// to whatever future global shortcut wants them.
export const PIANO_ROLL_TOOL_BINDINGS: Record<PianoRollToolAction, KeyCombo[]> = {
  'pianoRoll.toolPointer': [{ key: '1' }],
  'pianoRoll.toolEraser': [{ key: '2' }],
  'pianoRoll.toolSelect': [{ key: '3' }],
};

/**
 * The single seam between a key event and a piano-roll tool change. Returns the
 * tool a key event selects, or null if it isn't a tool shortcut. Swap the body
 * for `getShortcutRegistry().matches(...)` when these move into the central map.
 */
export function resolvePianoRollToolAction(e: KeyboardEvent): PianoRollToolId | null {
  for (const action of Object.keys(PIANO_ROLL_TOOL_BINDINGS) as PianoRollToolAction[]) {
    if (PIANO_ROLL_TOOL_BINDINGS[action].some((combo) => matchesCombo(combo, e))) {
      return PIANO_ROLL_TOOL_BY_ACTION[action];
    }
  }
  return null;
}
