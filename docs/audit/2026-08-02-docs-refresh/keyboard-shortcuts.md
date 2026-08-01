# Keyboard-Shortcuts.md — audit 2026-08-02

## Verified (spot checks that held)

- The live, reactive shortcut registry is `getShortcutRegistry()` in `src/services/shortcutRegistry.ts`; it reads `activeShortcutPreset` and `shortcutOverrides` from `src/stores/settingsStore.ts` and subscribes for updates.
- Six shipped presets and the table's listed preset-specific bindings are defined in `src/services/shortcutPresets.ts`: MasterSelects, Premiere Pro, DaVinci Resolve, Final Cut Pro, After Effects, and Beginner. `beginner` has no overrides, so it matches MasterSelects.
- Playback, in/out, marker, frame-step, copy/delete priority, split, blend-mode, project, undo/redo, and preview-slot claims are implemented by `src/components/timeline/hooks/useTimelineKeyboard.ts`, `src/components/common/toolbar/useToolbarProjectShortcuts.ts`, and `src/services/shortcutPresets.ts`.
- Timeline wheel behavior is implemented in `src/components/timeline/hooks/useTimelineZoom.ts`: Shift+wheel pans horizontally; Ctrl/Cmd+wheel and Alt+wheel zoom; Ctrl/Cmd+Shift+wheel changes slot-grid state.
- The focus and text-entry rules are implemented in `src/services/shortcutFocusPolicy.ts`, with Source Monitor transport in `src/components/preview/sourceMonitor/useSourceMonitorKeyboard.ts` and toolbar save handling in `src/components/common/toolbar/useToolbarProjectShortcuts.ts`.
- Input Display behavior is implemented in `src/components/common/ShortcutDisplayOverlay.tsx` and its local settings state in `src/stores/settingsStore.ts`.

## Outdated or wrong (claim → reality, with file evidence)

- “`C` toggles the cut tool in the default preset” → the default preset maps `C` to `tool.blade`; `useTimelineKeyboard` selects the `blade` tool. Evidence: `src/services/shortcutPresets.ts`, `src/components/timeline/hooks/useTimelineKeyboard.ts`.
- “The German-layout `u-umlaut` key” → the preset maps the German-layout umlaut key. Evidence: `src/services/shortcutPresets.ts`.
- “Each action can store one or more combos” → the data type and preset maps support arrays, but the settings recorder replaces an action with exactly one recorded combo (`setShortcutOverride(actionId, [combo])`). Evidence: `src/services/shortcutTypes.ts`, `src/components/common/settings/ShortcutsSettings.tsx`, `src/stores/settingsStore.ts`.

## Noteworthy / unusual

- `G` is a shipped default shortcut for toggling timeline/graph view but was undocumented. Evidence: `src/services/shortcutPresets.ts`, `src/components/timeline/hooks/useTimelineKeyboard.ts`, `src/components/timeline/hooks/useTimelineCurveMode.ts`.
- Mask shortcuts are shipped but were undocumented: pen, path edit, rectangle, ellipse, close, invert, outline, select-all, and vertex-handle cycling. Evidence: `src/services/shortcutPresets.ts`, `src/components/panels/properties/masksTab/useMaskKeybindings.ts`.
- `ACTION_META` includes Masking, but `ShortcutsSettings` omits `Masking` from `CATEGORIES_ORDER`; those registered actions therefore do not appear in that settings list. Evidence: `src/services/shortcutPresets.ts`, `src/components/common/settings/ShortcutsSettings.tsx`.
- The project contains a separate rendered-site counterpart at `docs-site/src/content/docs/features/keyboard-shortcuts.md`; it was not changed because this audit was explicitly limited to the source doc and findings file.
