import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLiveStreamConfig, createIdleLiveStreamStatus, type StreamStoreApi } from '../../src/services/liveStream/streamTypes';

let fakeStore: StreamStoreApi;

vi.mock('../../src/stores/streamStore', () => ({
  useStreamStore: (selector: (state: StreamStoreApi) => unknown) => selector(fakeStore),
}));

import { GoLivePanel } from '../../src/components/panels/go-live/GoLivePanel';

function renderPanel() {
  return render(<GoLivePanel />);
}

beforeEach(() => {
  fakeStore = {
    config: createDefaultLiveStreamConfig(),
    status: { ...createIdleLiveStreamStatus(), helperAvailable: true },
    updateConfig: vi.fn(patch => { fakeStore.config = { ...fakeStore.config, ...patch }; }),
    goLive: vi.fn(async () => undefined),
    endStream: vi.fn(async () => undefined),
    refreshHelperAvailability: vi.fn(async () => undefined),
  };
});

afterEach(cleanup);

describe('GoLivePanel', () => {
  it('requires RTMP fields but allows auto mode to use cloud when the helper is unavailable', () => {
    const view = renderPanel();
    const action = screen.getByRole('button', { name: 'Go Live' });
    expect(action).toBeDisabled();

    fakeStore.config = { ...fakeStore.config, rtmpStreamKey: 'secret' };
    view.rerender(<GoLivePanel />);
    expect(action).toBeEnabled();

    fakeStore.config = { ...fakeStore.config, rtmpUrl: '' };
    view.rerender(<GoLivePanel />);
    expect(action).toBeDisabled();

    fakeStore.config = { ...fakeStore.config, rtmpUrl: 'rtmp://example.test/live' };
    fakeStore.status = { ...fakeStore.status, helperAvailable: false };
    view.rerender(<GoLivePanel />);
    expect(action).toBeEnabled();
    expect(screen.getByText('Streaming via cloud relay (sign-in required)')).toBeInTheDocument();
  });

  it('keeps helper mode disabled when the Native Helper is unavailable', () => {
    fakeStore.config = {
      ...fakeStore.config,
      rtmpRelay: 'helper',
      rtmpUrl: 'rtmp://example.test/live',
      rtmpStreamKey: 'secret',
    };
    fakeStore.status = { ...fakeStore.status, helperAvailable: false };
    renderPanel();

    expect(screen.getByRole('button', { name: 'Go Live' })).toBeDisabled();
    expect(screen.getByText('Native Helper not connected — RTMP needs the helper')).toBeInTheDocument();
  });

  it('patches the selected RTMP relay mode', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Relay'), { target: { value: 'cloud' } });
    expect(fakeStore.updateConfig).toHaveBeenCalledWith({ rtmpRelay: 'cloud' });
  });

  it('starts with valid configuration and ends a live stream', () => {
    fakeStore.config = { ...fakeStore.config, rtmpUrl: 'rtmp://example.test/live', rtmpStreamKey: 'secret' };
    const view = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Go Live' }));
    expect(fakeStore.goLive).toHaveBeenCalledTimes(1);

    fakeStore.status = { ...fakeStore.status, phase: 'live', startedAtMs: Date.now() - 5_000 };
    view.rerender(<GoLivePanel />);
    fireEvent.click(screen.getByRole('button', { name: 'End Stream' }));
    expect(fakeStore.endStream).toHaveBeenCalledTimes(1);
  });

  it('masks the stream key until reveal is toggled', () => {
    fakeStore.config = { ...fakeStore.config, rtmpStreamKey: 'secret' };
    renderPanel();
    const input = screen.getByLabelText('Stream key');
    expect(input).toHaveAttribute('type', 'password');

    fireEvent.click(screen.getByRole('button', { name: 'Reveal stream key' }));
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders the store error banner', () => {
    fakeStore.status = { ...fakeStore.status, phase: 'error', lastError: 'Relay connection failed.' };
    renderPanel();
    expect(screen.getByRole('alert')).toHaveTextContent('Relay connection failed.');
  });

  it('shows the active RTMP relay while live', () => {
    fakeStore.status = {
      ...fakeStore.status,
      phase: 'live',
      transport: 'rtmp',
      activeRtmpRelay: 'cloud',
      startedAtMs: Date.now(),
    };
    renderPanel();
    expect(screen.getByText('relay: cloud')).toBeInTheDocument();
  });
});
