import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withShortcutHint } from '../../src/services/shortcutRegistry';
import { useSettingsStore } from '../../src/stores/settingsStore';

vi.unmock('../../src/stores/settingsStore');

// Tooltips name the shortcut the active preset really binds: the loop button once said "(L)",
// while L plays forward and the default preset toggles the loop with Shift+L.
describe('withShortcutHint', () => {
  beforeEach(() => {
    useSettingsStore.setState({ activeShortcutPreset: 'masterselects', shortcutOverrides: {}, customPresets: [] });
  });

  it('names the default binding of the loop toggle', () => {
    expect(withShortcutHint('Loop Off', 'playback.toggleLoop')).toBe('Loop Off (Shift+L)');
  });

  it('follows the active preset and the user overrides', () => {
    useSettingsStore.setState({ activeShortcutPreset: 'premiere' });
    expect(withShortcutHint('Loop Off', 'playback.toggleLoop')).toBe('Loop Off (Ctrl+L)');
    useSettingsStore.setState({ shortcutOverrides: { 'playback.toggleLoop': [] } });
    expect(withShortcutHint('Loop Off', 'playback.toggleLoop')).toBe('Loop Off');
  });
});
