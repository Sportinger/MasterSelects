import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { AppearanceSettings } from '../../src/components/common/settings/AppearanceSettings';
import { useSettingsStore } from '../../src/stores/settingsStore';

const mockedUseSettingsStore = useSettingsStore as unknown as Mock;

describe('AppearanceSettings', () => {
  const setAudioMixerWoodThemeEnabled = vi.fn();

  beforeEach(() => {
    setAudioMixerWoodThemeEnabled.mockReset();
    mockedUseSettingsStore.mockImplementation((selector: (state: {
      theme: string;
      customHue: number;
      customBrightness: number;
      setTheme: (theme: string) => void;
      setCustomHue: (hue: number) => void;
      setCustomBrightness: (brightness: number) => void;
      audioMixerWoodThemeEnabled: boolean;
      setAudioMixerWoodThemeEnabled: (enabled: boolean) => void;
    }) => unknown) => selector({
      theme: 'dark',
      customHue: 210,
      customBrightness: 15,
      setTheme: vi.fn(),
      setCustomHue: vi.fn(),
      setCustomBrightness: vi.fn(),
      audioMixerWoodThemeEnabled: true,
      setAudioMixerWoodThemeEnabled,
    }));
  });

  it('exposes the wooden mixer theme toggle in Appearance preferences', () => {
    render(<AppearanceSettings />);

    const checkbox = screen.getByLabelText('Wooden mixer theme');

    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);

    expect(setAudioMixerWoodThemeEnabled).toHaveBeenCalledWith(false);
  });
});
