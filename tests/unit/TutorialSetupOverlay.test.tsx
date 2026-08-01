import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TutorialSetupOverlay } from '../../src/components/common/tutorial/TutorialSetupOverlay';
import { useSettingsStore } from '../../src/stores/settingsStore';

describe('TutorialSetupOverlay', () => {
  const setUserBackground = vi.fn();
  const setActiveShortcutPreset = vi.fn();

  beforeEach(() => {
    vi.mocked(useSettingsStore).mockImplementation(((selector: (state: unknown) => unknown) => (
      selector({ setActiveShortcutPreset, setUserBackground })
    )) as typeof useSettingsStore);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('switches the shortcut preset and continues into the walkthrough', () => {
    const onComplete = vi.fn();
    render(<TutorialSetupOverlay onCancel={vi.fn()} onComplete={onComplete} />);

    expect(screen.getByText('Where are you coming from?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'DaVinci Resolve' }));

    expect(setUserBackground).toHaveBeenCalledWith('davinci');
    expect(setActiveShortcutPreset).toHaveBeenCalledWith('davinci');
    expect(screen.getByText('Shortcuts switched')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Start walkthrough' }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('can be ended from every setup state', () => {
    const onCancel = vi.fn();
    render(<TutorialSetupOverlay onCancel={onCancel} onComplete={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'End walkthrough' }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
