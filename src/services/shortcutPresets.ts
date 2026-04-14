// Keyboard Shortcut Presets — NLE-specific default key bindings

import type {
  ShortcutActionId,
  ShortcutActionMeta,
  ShortcutMap,
  ShortcutPreset,
  ShortcutPresetId,
  KeyCombo,
} from './shortcutTypes';

// ─── Action metadata (for Settings UI) ──────────────────────────────

export const ACTION_META: ShortcutActionMeta[] = [
  // Playback
  { id: 'playback.playPause', label: 'Play / Pause', category: 'Playback' },
  { id: 'playback.pause', label: 'Pause', category: 'Playback' },
  { id: 'playback.playForward', label: 'Play Forward', category: 'Playback' },
  { id: 'playback.playReverse', label: 'Play Reverse', category: 'Playback' },
  { id: 'playback.toggleLoop', label: 'Toggle Loop', category: 'Playback' },
  // Navigation
  { id: 'nav.frameForward', label: 'Frame Forward', category: 'Navigation' },
  { id: 'nav.frameBackward', label: 'Frame Backward', category: 'Navigation' },
  // Editing
  { id: 'edit.setIn', label: 'Set In Point', category: 'Editing' },
  { id: 'edit.setOut', label: 'Set Out Point', category: 'Editing' },
  { id: 'edit.clearInOut', label: 'Clear In/Out', category: 'Editing' },
  { id: 'edit.addMarker', label: 'Add Marker', category: 'Editing' },
  { id: 'edit.splitAtPlayhead', label: 'Split at Playhead', category: 'Editing' },
  { id: 'edit.delete', label: 'Delete', category: 'Editing' },
  { id: 'edit.copy', label: 'Copy', category: 'Editing' },
  { id: 'edit.paste', label: 'Paste', category: 'Editing' },
  { id: 'edit.blendModeNext', label: 'Next Blend Mode', category: 'Editing' },
  { id: 'edit.blendModePrev', label: 'Previous Blend Mode', category: 'Editing' },
  // Tools
  { id: 'tool.cutToggle', label: 'Cut / Razor Tool', category: 'Tools' },
  // Project
  { id: 'project.new', label: 'New Project', category: 'Project' },
  { id: 'project.open', label: 'Open Project', category: 'Project' },
  { id: 'project.save', label: 'Save', category: 'Project' },
  { id: 'project.saveAs', label: 'Save As', category: 'Project' },
  // History
  { id: 'history.undo', label: 'Undo', category: 'History' },
  { id: 'history.redo', label: 'Redo', category: 'History' },
  // Panels
  { id: 'panel.toggleHoveredFullscreen', label: 'Toggle Hovered Tab Fullscreen', category: 'Panels' },
  // Preview
  { id: 'preview.editMode', label: 'Toggle Edit Mode', category: 'Preview' },
  { id: 'preview.slot1', label: 'Preview Slot 1', category: 'Preview' },
  { id: 'preview.slot2', label: 'Preview Slot 2', category: 'Preview' },
  { id: 'preview.slot3', label: 'Preview Slot 3', category: 'Preview' },
  { id: 'preview.slot4', label: 'Preview Slot 4', category: 'Preview' },
];

// All valid action IDs (for runtime validation)
export const ALL_ACTION_IDS: ShortcutActionId[] = ACTION_META.map((m) => m.id);

// ─── Base map (shared across all NLEs) ──────────────────────────────

const BASE_MAP: ShortcutMap = {
  // Playback
  'playback.playPause': [{ code: 'Space' }],
  'playback.pause': [{ key: 'k' }],
  'playback.playForward': [{ key: 'l' }],
  'playback.playReverse': [{ key: 'j' }],
  'playback.toggleLoop': [{ key: 'l', shift: true }],
  // Navigation
  'nav.frameForward': [{ key: 'arrowright' }],
  'nav.frameBackward': [{ key: 'arrowleft' }],
  // In/Out
  'edit.setIn': [{ key: 'i' }],
  'edit.setOut': [{ key: 'o' }],
  'edit.clearInOut': [{ key: 'x' }],
  // Markers
  'edit.addMarker': [{ key: 'm' }],
  // Delete (two keys)
  'edit.delete': [{ key: 'delete' }, { key: 'backspace' }],
  // Copy/Paste
  'edit.copy': [{ key: 'c', ctrl: true }],
  'edit.paste': [{ key: 'v', ctrl: true }],
  // Blend modes
  'edit.blendModeNext': [{ code: 'NumpadAdd' }, { key: '+' }],
  'edit.blendModePrev': [{ code: 'NumpadSubtract' }, { key: '-' }],
  // Project
  'project.new': [{ key: 'n', ctrl: true }],
  'project.open': [{ key: 'o', ctrl: true }],
  'project.save': [{ key: 's', ctrl: true }],
  'project.saveAs': [{ key: 's', ctrl: true, shift: true }],
  // History
  'history.undo': [{ key: 'z', ctrl: true }],
  'history.redo': [{ key: 'z', ctrl: true, shift: true }, { key: 'y', ctrl: true }],
  // Panels
  'panel.toggleHoveredFullscreen': [{ key: 'ü' }],
  // Overridden per preset:
  'tool.cutToggle': [{ key: 'c' }],
  'edit.splitAtPlayhead': [{ key: 'c', shift: true }],
  // Preview
  'preview.editMode': [{ key: 'tab' }],
  'preview.slot1': [{ key: '1' }],
  'preview.slot2': [{ key: '2' }],
  'preview.slot3': [{ key: '3' }],
  'preview.slot4': [{ key: '4' }],
};

// ─── Helper: create preset by overriding base ───────────────────────

function createPreset(
  id: ShortcutPresetId,
  label: string,
  overrides: Partial<Record<ShortcutActionId, KeyCombo[]>>,
): ShortcutPreset {
  return {
    id,
    label,
    map: { ...BASE_MAP, ...overrides },
  };
}

// ─── Presets ─────────────────────────────────────────────────────────

const masterselects = createPreset('masterselects', 'MasterSelects', {
  // Default — no overrides, uses BASE_MAP as-is
});

const premiere = createPreset('premiere', 'Premiere Pro', {
  // Ctrl+L = Loop (Premiere default)
  'playback.toggleLoop': [{ key: 'l', ctrl: true }],
  // Ctrl+Shift+X = Clear In/Out
  'edit.clearInOut': [{ key: 'x', ctrl: true, shift: true }],
  // C = Razor tool
  'tool.cutToggle': [{ key: 'c' }],
  // Ctrl+K = Add Edit (split at playhead)
  'edit.splitAtPlayhead': [{ key: 'k', ctrl: true }],
  // Ctrl+Alt+N = New Project (Ctrl+N is New Sequence in Premiere)
  'project.new': [{ key: 'n', ctrl: true, alt: true }],
  // Redo: Ctrl+Shift+Z only (no Ctrl+Y in Premiere default)
  'history.redo': [{ key: 'z', ctrl: true, shift: true }],
  // Blend modes: N/A in Premiere — keep MasterSelects default
});

const davinci = createPreset('davinci', 'DaVinci Resolve', {
  // Ctrl+/ = Loop
  'playback.toggleLoop': [{ key: '/', ctrl: true }],
  // Alt+X = Clear In/Out
  'edit.clearInOut': [{ key: 'x', alt: true }],
  // B = Blade tool
  'tool.cutToggle': [{ key: 'b' }],
  // Ctrl+B = Split at playhead
  'edit.splitAtPlayhead': [{ key: 'b', ctrl: true }],
  // Backspace = lift, Delete = ripple delete (both remove clips)
  'edit.delete': [{ key: 'backspace' }, { key: 'delete' }],
  // No default New/Open Project shortcuts in DaVinci
  'project.new': [],
  'project.open': [],
  // Redo: Ctrl+Shift+Z only
  'history.redo': [{ key: 'z', ctrl: true, shift: true }],
  // Blend modes: N/A in DaVinci — keep MasterSelects default
});

const finalcut = createPreset('finalcut', 'Final Cut Pro', {
  // Cmd+L = Loop (ctrl maps to Cmd on Mac)
  'playback.toggleLoop': [{ key: 'l', ctrl: true }],
  // Option+X = Clear In/Out (alt maps to Option on Mac)
  'edit.clearInOut': [{ key: 'x', alt: true }],
  // B = Blade tool
  'tool.cutToggle': [{ key: 'b' }],
  // Cmd+B = Blade at playhead
  'edit.splitAtPlayhead': [{ key: 'b', ctrl: true }],
  // Delete = ripple delete (FCP default)
  'edit.delete': [{ key: 'delete' }, { key: 'backspace' }],
  // Cmd+N = New Project
  'project.new': [{ key: 'n', ctrl: true }],
  // FCP auto-saves — no Save/Save As shortcuts
  'project.save': [],
  'project.saveAs': [],
  // Redo: Cmd+Shift+Z only
  'history.redo': [{ key: 'z', ctrl: true, shift: true }],
  // Blend modes: N/A in FCP
});

const aftereffects = createPreset('aftereffects', 'After Effects', {
  // AE has no JKL shuttle — Space is play/pause, no separate pause/forward/reverse
  'playback.pause': [],
  'playback.playForward': [],
  'playback.playReverse': [],
  // No loop toggle shortcut in AE (Preview panel setting)
  'playback.toggleLoop': [],
  // Page Down / Ctrl+Right = frame forward, Page Up / Ctrl+Left = frame backward
  'nav.frameForward': [{ key: 'pagedown' }, { key: 'arrowright', ctrl: true }],
  'nav.frameBackward': [{ key: 'pageup' }, { key: 'arrowleft', ctrl: true }],
  // B = Set work area begin (In), N = Set work area end (Out)
  'edit.setIn': [{ key: 'b' }],
  'edit.setOut': [{ key: 'n' }],
  // No default Clear In/Out in AE
  'edit.clearInOut': [],
  // Numpad * = Add marker (use Shift+8 as alternative since not everyone has numpad)
  'edit.addMarker': [{ code: 'NumpadMultiply' }, { key: '8', shift: true }],
  // Ctrl+Shift+D = Split layer
  'edit.splitAtPlayhead': [{ key: 'd', ctrl: true, shift: true }],
  // Delete only (no Backspace default)
  'edit.delete': [{ key: 'delete' }],
  // Shift+= / Shift+- = cycle blend modes (AE actually has this!)
  'edit.blendModeNext': [{ key: '=', shift: true }],
  'edit.blendModePrev': [{ key: '-', shift: true }],
  // No Razor tool in AE
  'tool.cutToggle': [],
  // Ctrl+Alt+N = New Project (Ctrl+N is New Comp in AE)
  'project.new': [{ key: 'n', ctrl: true, alt: true }],
  // Redo: Ctrl+Shift+Z only
  'history.redo': [{ key: 'z', ctrl: true, shift: true }],
});

const beginner = createPreset('beginner', 'Beginner', {
  // Same as MasterSelects default — simplest layout
});

// ─── Exports ─────────────────────────────────────────────────────────

export const PRESETS: Record<ShortcutPresetId, ShortcutPreset> = {
  masterselects,
  premiere,
  davinci,
  finalcut,
  aftereffects,
  beginner,
};

export const PRESET_LIST: ShortcutPreset[] = [
  masterselects,
  premiere,
  davinci,
  finalcut,
  aftereffects,
  beginner,
];

export const DEFAULT_PRESET_ID: ShortcutPresetId = 'masterselects';
