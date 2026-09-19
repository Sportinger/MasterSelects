import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SourceSection } from '../../src/components/panels/properties/transformTab/SourceSection';

const mockState = vi.hoisted(() => ({
  connected: false,
  connect: vi.fn(),
  updateLiveInputSource: vi.fn(),
}));

vi.mock('../../src/services/mediaRuntime/liveInputRuntime', () => ({
  liveInputRuntime: {
    connect: mockState.connect,
    getRevision: () => 0,
    getVideoElement: () => mockState.connected ? document.createElement('video') : null,
    subscribe: () => () => undefined,
  },
}));

vi.mock('../../src/stores/timeline', () => {
  const state = {
    clips: [{
      id: 'clip-live',
      source: {
        type: 'video',
        mediaFileId: 'live-camera',
        liveInputId: 'live-camera',
      },
    }],
    replaceClipSource: vi.fn(),
    replaceClipSourceWithComposition: vi.fn(),
  };
  return {
    useTimelineStore: vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
  };
});

vi.mock('../../src/stores/mediaStore', () => {
  const state = {
    activeCompositionId: 'comp-1',
    compositions: [{ id: 'comp-1', name: 'Main' }],
    files: [{
      id: 'live-camera',
      name: 'Camera Item',
      liveInput: {
        kind: 'video-device' as const,
        deviceId: 'saved-camera',
        deviceLabel: 'Studio Camera',
      },
    }],
    updateLiveInputSource: mockState.updateLiveInputSource,
  };
  return {
    useMediaStore: vi.fn((selector: (value: typeof state) => unknown) => selector(state)),
  };
});

function renderSourceSection() {
  return render(
    <SourceSection
      clipId="clip-live"
      freeRun={false}
      isEffectively3D={false}
      isLocked3D={false}
      mediaFileId="live-camera"
      supportsFreeRun={false}
      onFreeRunToggle={vi.fn()}
      onToggle3D={vi.fn()}
    />,
  );
}

describe('live input Source section', () => {
  beforeEach(() => {
    mockState.connected = false;
    mockState.connect.mockReset();
    mockState.updateLiveInputSource.mockReset();
    const video = document.createElement('video');
    Object.defineProperty(video, 'srcObject', {
      configurable: true,
      value: {
        getVideoTracks: () => [{ getSettings: () => ({ deviceId: 'saved-camera' }) }],
      },
    });
    mockState.connect.mockResolvedValue({ label: 'Studio Camera', video });
  });

  it('shows RECONNECT in red and reconnects the saved source directly', async () => {
    renderSourceSection();

    const reconnect = screen.getByRole('button', { name: 'Reconnect live source Studio Camera' });
    expect(reconnect).toHaveTextContent('RECONNECT');
    expect(reconnect).toHaveClass('needs-reconnect');
    fireEvent.click(reconnect);

    await waitFor(() => expect(mockState.connect).toHaveBeenCalledWith(
      'live-camera',
      expect.objectContaining({ kind: 'video-device', deviceId: 'saved-camera' }),
    ));
    expect(mockState.updateLiveInputSource).toHaveBeenCalledWith('live-camera', {
      kind: 'video-device',
      deviceId: 'saved-camera',
      deviceLabel: 'Studio Camera',
    });
  });

  it('opens the source chooser from the blue connected source name', () => {
    mockState.connected = true;
    renderSourceSection();

    const sourceName = screen.getByRole('button', { name: 'Choose live source for Studio Camera' });
    expect(sourceName).toHaveTextContent('Studio Camera');
    expect(sourceName).not.toHaveClass('needs-reconnect');
    fireEvent.click(sourceName);

    expect(screen.getByRole('dialog', { name: 'Select Live Source' })).toBeInTheDocument();
    expect(screen.getByLabelText('Device')).toHaveValue('saved-camera');
  });
});
