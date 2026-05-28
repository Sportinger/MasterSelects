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
  { id: 'tool.select', label: 'Select Tool', category: 'Tools' },
  { id: 'tool.selectionGroup', label: 'Cycle Selection Tools', category: 'Tools' },
  { id: 'tool.trackSelectForward', label: 'Track Select Forward Tool', category: 'Tools' },
  { id: 'tool.trackSelectBackward', label: 'Track Select Backward Tool', category: 'Tools' },
  { id: 'tool.trackSelectForwardAll', label: 'Track Select Forward All Tracks Tool', category: 'Tools' },
  { id: 'tool.rangeSelect', label: 'Range Selection Tool', category: 'Tools' },
  { id: 'tool.cutToggle', label: 'Cut / Razor Tool', category: 'Tools' },
  { id: 'tool.blade', label: 'Blade Tool', category: 'Tools' },
  { id: 'tool.bladeAllTracks', label: 'Blade All Tracks Tool', category: 'Tools' },
  { id: 'tool.trimGroup', label: 'Cycle Trim Tools', category: 'Tools' },
  { id: 'tool.edgeTrim', label: 'Normal Edge Trim Tool', category: 'Tools' },
  { id: 'tool.rippleTrim', label: 'Ripple Trim Tool', category: 'Tools' },
  { id: 'tool.rollingEdit', label: 'Rolling Edit Tool', category: 'Tools' },
  { id: 'tool.slip', label: 'Slip Tool', category: 'Tools' },
  { id: 'tool.slide', label: 'Slide Tool', category: 'Tools' },
  { id: 'tool.rateStretch', label: 'Rate Stretch Tool', category: 'Tools' },
  { id: 'tool.placementGroup', label: 'Cycle Placement Tools', category: 'Tools' },
  { id: 'tool.positionOverwrite', label: 'Position / Overwrite Move Tool', category: 'Tools' },
  { id: 'tool.navigationGroup', label: 'Cycle Navigation Tools', category: 'Tools' },
  { id: 'tool.hand', label: 'Hand / Pan Tool', category: 'Tools' },
  { id: 'tool.zoom', label: 'Zoom Tool', category: 'Tools' },
  { id: 'tool.penKeyframe', label: 'Pen / Keyframe Tool', category: 'Tools' },
  { id: 'edit.splitAllAtPlayhead', label: 'Split All Tracks at Playhead', category: 'Editing' },
  { id: 'edit.trimStartToPlayhead', label: 'Trim Start to Playhead', category: 'Editing' },
  { id: 'edit.trimEndToPlayhead', label: 'Trim End to Playhead', category: 'Editing' },
  { id: 'edit.rippleTrimStartToPlayhead', label: 'Ripple Trim Start to Playhead', category: 'Editing' },
  { id: 'edit.rippleTrimEndToPlayhead', label: 'Ripple Trim End to Playhead', category: 'Editing' },
  { id: 'edit.rippleDelete', label: 'Ripple Delete', category: 'Editing' },
  { id: 'edit.deleteGap', label: 'Delete Gap', category: 'Editing' },
  { id: 'edit.liftRange', label: 'Lift Range', category: 'Editing' },
  { id: 'edit.extractRange', label: 'Extract Range', category: 'Editing' },
  { id: 'edit.insertSource', label: 'Insert Source', category: 'Editing' },
  { id: 'edit.overwriteSource', label: 'Overwrite Source', category: 'Editing' },
  { id: 'edit.replaceSource', label: 'Replace With Source', category: 'Editing' },
  { id: 'edit.fitToFillSource', label: 'Fit Source to Fill', category: 'Editing' },
  { id: 'edit.appendSourceAtEnd', label: 'Append Source at End', category: 'Editing' },
  { id: 'edit.placeSourceOnTop', label: 'Place Source on Top', category: 'Editing' },
  { id: 'edit.rippleOverwriteSource', label: 'Ripple Overwrite Source', category: 'Editing' },
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
  // Masking
  { id: 'mask.pen', label: 'Pen Mask Tool', category: 'Masking' },
  { id: 'mask.edit', label: 'Edit Mask Path', category: 'Masking' },
  { id: 'mask.rectangle', label: 'Rectangle Mask Tool', category: 'Masking' },
  { id: 'mask.ellipse', label: 'Ellipse Mask Tool', category: 'Masking' },
  { id: 'mask.closePath', label: 'Close Mask Path', category: 'Masking' },
  { id: 'mask.invert', label: 'Invert Active Mask', category: 'Masking' },
  { id: 'mask.toggleOutline', label: 'Toggle Mask Outline', category: 'Masking' },
  { id: 'mask.selectAllVertices', label: 'Select All Mask Vertices', category: 'Masking' },
  { id: 'mask.toggleVertexHandles', label: 'Toggle Selected Vertex Handles', category: 'Masking' },
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
  'tool.select': [{ key: 'v' }],
  'tool.selectionGroup': [{ key: 'a' }],
  'tool.trackSelectForward': [],
  'tool.trackSelectBackward': [],
  'tool.trackSelectForwardAll': [],
  'tool.rangeSelect': [],
  'tool.cutToggle': [],
  'tool.blade': [{ key: 'c' }],
  'tool.bladeAllTracks': [],
  'tool.trimGroup': [{ key: 't' }],
  'tool.edgeTrim': [],
  'tool.rippleTrim': [],
  'tool.rollingEdit': [],
  'tool.slip': [],
  'tool.slide': [],
  'tool.rateStretch': [],
  'tool.placementGroup': [],
  'tool.positionOverwrite': [],
  'tool.navigationGroup': [],
  'tool.hand': [],
  'tool.zoom': [],
  'tool.penKeyframe': [],
  'edit.splitAtPlayhead': [{ key: 'c', shift: true }],
  'edit.splitAllAtPlayhead': [],
  'edit.trimStartToPlayhead': [],
  'edit.trimEndToPlayhead': [],
  'edit.rippleTrimStartToPlayhead': [],
  'edit.rippleTrimEndToPlayhead': [],
  'edit.rippleDelete': [],
  'edit.deleteGap': [],
  'edit.liftRange': [],
  'edit.extractRange': [],
  'edit.insertSource': [],
  'edit.overwriteSource': [],
  'edit.replaceSource': [],
  'edit.fitToFillSource': [],
  'edit.appendSourceAtEnd': [],
  'edit.placeSourceOnTop': [],
  'edit.rippleOverwriteSource': [],
  // Preview
  'preview.editMode': [{ key: 'tab' }],
  'preview.slot1': [{ key: '1' }],
  'preview.slot2': [{ key: '2' }],
  'preview.slot3': [{ key: '3' }],
  'preview.slot4': [{ key: '4' }],
  // Masking
  'mask.pen': [{ key: 'p' }],
  'mask.edit': [{ key: 'v' }],
  'mask.rectangle': [{ key: 'r' }],
  'mask.ellipse': [{ key: 'e' }],
  'mask.closePath': [{ key: 'enter' }],
  'mask.invert': [{ key: 'i', alt: true }],
  'mask.toggleOutline': [{ key: 'h', alt: true }],
  'mask.selectAllVertices': [{ key: 'a', ctrl: true }],
  'mask.toggleVertexHandles': [{ key: 'b' }],
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
  'tool.select': [{ key: 'v' }],
  'tool.cutToggle': [],
  'tool.blade': [{ key: 'c' }],
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
  'tool.select': [{ key: 'a' }],
  'tool.cutToggle': [],
  'tool.blade': [{ key: 'b' }],
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
  'tool.select': [{ key: 'a' }],
  'tool.cutToggle': [],
  'tool.blade': [{ key: 'b' }],
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
  'tool.select': [{ key: 'v' }],
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
