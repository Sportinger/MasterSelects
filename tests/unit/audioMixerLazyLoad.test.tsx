import { render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DockPanelContent } from '../../src/components/dock/DockPanelContent';

const { importAudioMixerPanel } = vi.hoisted(() => ({
  importAudioMixerPanel: vi.fn(async () => ({ default: () => null })),
}));

vi.mock('../../src/components/panels/audio-mixer/audioMixerPanelLoader', () => ({
  importAudioMixerPanel,
}));

describe('Audio Mixer lazy loading', () => {
  it('loads the mixer chunk only when the panel renders', async () => {
    expect(importAudioMixerPanel).not.toHaveBeenCalled();

    render(<DockPanelContent panel={{ id: 'audio-mixer', type: 'audio-mixer', title: 'Audio Mixer' }} />);

    await waitFor(() => expect(importAudioMixerPanel).toHaveBeenCalledOnce());
  });
});
