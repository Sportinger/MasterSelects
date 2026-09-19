import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultLiveStreamConfig, createIdleLiveStreamStatus, type StreamStoreApi } from '../../src/services/liveStream/streamTypes';
import type { TwitchPlatformStats } from '../../src/services/liveStream/twitchPlatformStats';

let fakeStore: StreamStoreApi;
let nextStats: TwitchPlatformStats | null;
// vi.mock factories are hoisted above const initializers, so the mock fns
// must be created inside vi.hoisted to exist when the factory runs.
const { startPolling, stopPolling } = vi.hoisted(() => {
  const stopPolling = vi.fn();
  const startPolling = vi.fn((_getChannel: () => string, onUpdate: (stats: TwitchPlatformStats) => void) => {
    if (nextStats) onUpdate(nextStats);
    return stopPolling;
  });
  return { startPolling, stopPolling };
});

vi.mock('../../src/stores/streamStore', () => ({
  useStreamStore: (selector: (state: StreamStoreApi) => unknown) => selector(fakeStore),
}));

vi.mock('../../src/services/liveStream/twitchPlatformStats', async importOriginal => {
  const original = await importOriginal<typeof import('../../src/services/liveStream/twitchPlatformStats')>();
  return { ...original, startTwitchPlatformStatsPolling: startPolling };
});

import { PlatformStatsSection } from '../../src/components/panels/stream-analytics/PlatformStatsSection';

beforeEach(() => {
  nextStats = null;
  stopPolling.mockClear();
  startPolling.mockClear();
  fakeStore = {
    config: createDefaultLiveStreamConfig(),
    status: createIdleLiveStreamStatus(),
    sessionLog: [],
    updateConfig: vi.fn(),
    goLive: vi.fn(async () => undefined),
    endStream: vi.fn(async () => undefined),
    refreshHelperAvailability: vi.fn(async () => undefined),
    clearSessionLog: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('PlatformStatsSection', () => {
  it('renders the channel setup state when no Twitch channel is selected', () => {
    render(<PlatformStatsSection />);
    expect(screen.getByText('Add a Twitch channel to show live platform stats.')).toBeInTheDocument();
    expect(screen.getByLabelText('Twitch channel')).toBeInTheDocument();
    expect(startPolling).not.toHaveBeenCalled();
  });

  it('shows setup guidance when server credentials are not configured', () => {
    fakeStore.config = { ...fakeStore.config, chatChannel: 'creator', chatPlatform: 'twitch' };
    nextStats = { configured: false };
    render(<PlatformStatsSection />);
    expect(screen.getByText('Connect a Twitch application')).toBeInTheDocument();
    expect(screen.getByText(/TWITCH_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getByText(/TWITCH_CLIENT_SECRET/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Twitch Developer Console' })).toHaveAttribute(
      'href',
      'https://dev.twitch.tv/console/apps',
    );
  });

  it('renders live viewer, title, category, and uptime data', () => {
    fakeStore.config = { ...fakeStore.config, chatChannel: 'creator', chatPlatform: 'twitch' };
    nextStats = {
      configured: true,
      channel: 'creator',
      displayName: 'Creator',
      profileImageUrl: '',
      live: true,
      viewerCount: 1234,
      title: 'Building a video editor',
      gameName: 'Science & Technology',
      startedAt: new Date(Date.now() - 65_000).toISOString(),
    };
    render(<PlatformStatsSection />);
    expect(screen.getByText('LIVE')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('Building a video editor')).toBeInTheDocument();
    expect(screen.getByText('Science & Technology')).toBeInTheDocument();
    expect(screen.getByText('00:01:05')).toBeInTheDocument();
  });

  it('debounces channel edits into the stream config', () => {
    vi.useFakeTimers();
    render(<PlatformStatsSection />);
    fireEvent.change(screen.getByLabelText('Twitch channel'), { target: { value: 'new_creator' } });
    expect(fakeStore.updateConfig).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(500); });
    expect(fakeStore.updateConfig).toHaveBeenCalledWith({
      chatChannel: 'new_creator',
      chatPlatform: 'twitch',
    });
  });
});
