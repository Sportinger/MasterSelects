import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  CompositionSettingsDialog,
  type CompositionSettingsValues,
  updateLinkedCompositionResolution,
} from '../../src/components/panels/media/CompositionSettingsDialog';

const INITIAL_SETTINGS: CompositionSettingsValues = {
  name: 'Comp 4',
  width: 1920,
  height: 1080,
  frameRate: 30,
  duration: 60,
};

function Harness() {
  const [settings, setSettings] = useState(INITIAL_SETTINGS);
  return (
    <CompositionSettingsDialog
      settings={settings}
      onSettingsChange={setSettings}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />
  );
}

describe('CompositionSettingsDialog', () => {
  it('uses resolution presets without aspect-ratio buttons and shares the portrait switch', () => {
    render(<Harness />);

    expect(screen.getByRole('heading', { name: 'Composition Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '720p' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1080p' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '9:16' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '1:1' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Switch to 9:16 portrait' }));
    expect(screen.getByRole('button', { name: 'Switch to 16:9 landscape' })).toBeInTheDocument();
  });

  it('keeps the FPS presets in a dropdown and reveals a free custom value', () => {
    render(<Harness />);

    fireEvent.change(screen.getByLabelText('Frame Rate'), { target: { value: 'custom' } });
    expect(screen.getByLabelText('Custom composition frame rate')).toBeInTheDocument();
  });

  it('preserves the locked aspect ratio when either resolution side changes', () => {
    expect(updateLinkedCompositionResolution(INITIAL_SETTINGS, 'width', 1280, 16 / 9)).toMatchObject({
      width: 1280,
      height: 720,
    });
    expect(updateLinkedCompositionResolution(INITIAL_SETTINGS, 'height', 1920, 16 / 9)).toMatchObject({
      width: 3413,
      height: 1920,
    });
  });
});
