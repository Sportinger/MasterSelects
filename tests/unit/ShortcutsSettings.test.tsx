import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsSettings } from '../../src/components/common/settings/ShortcutsSettings';
import { useSettingsStore } from '../../src/stores/settingsStore';

vi.unmock('../../src/stores/settingsStore');

describe('shortcut settings search', () => {
  beforeEach(() => {
    useSettingsStore.setState({ activeShortcutPreset: 'masterselects', shortcutOverrides: {}, customPresets: [] });
  });
  afterEach(cleanup);

  function search(query: string) {
    fireEvent.change(screen.getByPlaceholderText('Search shortcuts...'), { target: { value: query } });
  }

  it.each(['Ctrl+S', ' ctrl + s ', 'Control S', 'Cmd+S', '⌘S'])(
    'finds the Save action by its binding: %s', (query) => {
      render(<ShortcutsSettings />);
      search(query);
      expect(screen.getByText('Save', { selector: '.shortcut-action-label' })).toBeInTheDocument();
      expect(screen.queryByText('Play / Pause')).not.toBeInTheDocument();
      expect(screen.queryByText('Redo')).not.toBeInTheDocument();
    },
  );

  it.each(['Space', 'ArrowRight', '→', 'NumpadAdd', '+'])(
    'finds physical and named keys: %s', (query) => {
      render(<ShortcutsSettings />);
      search(query);
      const label = query === 'Space' ? 'Play / Pause'
        : ['ArrowRight', '→'].includes(query) ? 'Frame Forward' : 'Next Blend Mode';
      expect(screen.getByText(label)).toBeInTheDocument();
    },
  );

  it('refreshes filtered results when the active preset changes', () => {
    render(<ShortcutsSettings />);
    search('Ctrl+K');
    expect(screen.queryByText('Split at Playhead')).not.toBeInTheDocument();
    act(() => useSettingsStore.getState().setActiveShortcutPreset('premiere'));
    expect(screen.getByText('Split at Playhead')).toBeInTheDocument();
  });

  it('searches current overrides and stops matching replaced bindings', () => {
    render(<ShortcutsSettings />);
    search('Ctrl+S');
    expect(screen.getByText('Save', { selector: '.shortcut-action-label' })).toBeInTheDocument();
    act(() => useSettingsStore.getState().setShortcutOverride('project.save', [{ ctrl: true, key: 'f12' }]));
    expect(screen.queryByText('Save', { selector: '.shortcut-action-label' })).not.toBeInTheDocument();
    search('Ctrl+F12');
    expect(screen.getByText('Save', { selector: '.shortcut-action-label' })).toBeInTheDocument();
  });

  it('retains description/category search and includes masking actions', () => {
    render(<ShortcutsSettings />);
    search('playback');
    expect(screen.getByText('Play / Pause')).toBeInTheDocument();
    search('mask');
    expect(screen.getByText('Edit Mask Path')).toBeInTheDocument();
  });
});
