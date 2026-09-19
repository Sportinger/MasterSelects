import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppearanceSettings } from '../../src/components/common/settings/AppearanceSettings';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedUseSettingsStore = useSettingsStore as unknown as Mock;

describe('AppearanceSettings', () => {
  const setAudioMixerWoodThemeEnabled = vi.fn();
  const setTheme = vi.fn();
  let resolveThemeUnlocked = false;
  const unlockResolveTheme = vi.fn(() => {
    resolveThemeUnlocked = true;
  });

  beforeEach(() => {
    resolveThemeUnlocked = false;
    setAudioMixerWoodThemeEnabled.mockReset();
    setTheme.mockReset();
    unlockResolveTheme.mockClear();
    mockedUseSettingsStore.mockImplementation((selector: (state: {
      theme: string;
      resolveThemeUnlocked: boolean;
      customHue: number;
      customBrightness: number;
      setTheme: (theme: string) => void;
      unlockResolveTheme: () => void;
      setCustomHue: (hue: number) => void;
      setCustomBrightness: (brightness: number) => void;
      audioMixerWoodThemeEnabled: boolean;
      setAudioMixerWoodThemeEnabled: (enabled: boolean) => void;
    }) => unknown) => selector({
      theme: 'dark',
      resolveThemeUnlocked,
      customHue: 210,
      customBrightness: 15,
      setTheme,
      unlockResolveTheme,
      setCustomHue: vi.fn(),
      setCustomBrightness: vi.fn(),
      audioMixerWoodThemeEnabled: true,
      setAudioMixerWoodThemeEnabled,
    }));
  });

  it('exposes the wooden mixer theme toggle in Appearance preferences', () => {
    render(<AppearanceSettings />);

    const checkbox = screen.getByLabelText('Wooden audio mixer theme');

    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(setAudioMixerWoodThemeEnabled).toHaveBeenCalledWith(false);
  });

  it('does not offer the retired Resolve-inspired editor theme', () => {
    render(<AppearanceSettings />);

    expect(screen.queryByLabelText('Resolve')).toBeNull();
  });

  it('reveals the Resolve theme after Shift plus 1, 2, 3, 4', () => {
    const { rerender } = render(<AppearanceSettings />);

    for (const code of ['Digit1', 'Digit2', 'Digit3', 'Digit4']) {
      fireEvent.keyDown(window, { code, shiftKey: true });
    }

    expect(unlockResolveTheme).toHaveBeenCalledTimes(1);
    rerender(<AppearanceSettings />);
    expect(screen.getByLabelText('Resolve')).toBeTruthy();
  });
});
