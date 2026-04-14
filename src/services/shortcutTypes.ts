// Keyboard Shortcut System - Type Definitions

// Every bindable action in the app
export type ShortcutActionId =
  // Playback
  | 'playback.playPause'
  | 'playback.pause'
  | 'playback.playForward'
  | 'playback.playReverse'
  | 'playback.toggleLoop'
  // Navigation
  | 'nav.frameForward'
  | 'nav.frameBackward'
  // In/Out
  | 'edit.setIn'
  | 'edit.setOut'
  | 'edit.clearInOut'
  // Markers
  | 'edit.addMarker'
  // Tools
  | 'tool.cutToggle'
  | 'edit.splitAtPlayhead'
  // Selection operations
  | 'edit.delete'
  | 'edit.copy'
  | 'edit.paste'
  // Blend modes
  | 'edit.blendModeNext'
  | 'edit.blendModePrev'
  // Project
  | 'project.new'
  | 'project.open'
  | 'project.save'
  | 'project.saveAs'
  // History
  | 'history.undo'
  | 'history.redo'
  // Panels
  | 'panel.toggleHoveredFullscreen'
  // Preview
  | 'preview.editMode'
  | 'preview.slot1'
  | 'preview.slot2'
  | 'preview.slot3'
  | 'preview.slot4';

// A single key combination
export interface KeyCombo {
  key?: string;       // e.key value (lowercase), e.g. 'c', 'arrowleft', 'delete'
  code?: string;      // e.code for physical key, e.g. 'Space', 'NumpadAdd'
  ctrl?: boolean;     // Ctrl (or Cmd on Mac)
  shift?: boolean;
  alt?: boolean;
}

// Complete shortcut map: action → key combos
export type ShortcutMap = Record<ShortcutActionId, KeyCombo[]>;

// Categories for grouping in UI
export type ShortcutCategory =
  | 'Playback'
  | 'Navigation'
  | 'Editing'
  | 'Tools'
  | 'Panels'
  | 'Project'
  | 'History'
  | 'Preview';

// Action metadata for settings UI display
export interface ShortcutActionMeta {
  id: ShortcutActionId;
  label: string;
  category: ShortcutCategory;
}

// Preset identifiers — matches TutorialOverlay WELCOME_BUTTONS
export type ShortcutPresetId =
  | 'masterselects'
  | 'premiere'
  | 'davinci'
  | 'finalcut'
  | 'aftereffects'
  | 'beginner';

export interface ShortcutPreset {
  id: ShortcutPresetId;
  label: string;
  map: ShortcutMap;
}

// User-saved named preset
export interface CustomShortcutPreset {
  name: string;
  map: ShortcutMap;
  createdAt: number;
}
