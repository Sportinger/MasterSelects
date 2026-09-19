import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDefaultLiveStreamConfig,
  type LiveStreamConfig,
} from '../../src/services/liveStream/streamTypes';

interface ChatStoreFixture {
  config: LiveStreamConfig;
  updateConfig: ReturnType<typeof vi.fn<(patch: Partial<LiveStreamConfig>) => void>>;
}

let fakeStore: ChatStoreFixture;

vi.mock('../../src/stores/streamStore', () => ({
  useStreamStore: (selector: (state: ChatStoreFixture) => unknown) => selector(fakeStore),
}));

import { StreamChatPanel } from '../../src/components/panels/stream-chat/StreamChatPanel';

function setChatConfig(patch: Partial<LiveStreamConfig> = {}): void {
  fakeStore = {
    config: { ...createDefaultLiveStreamConfig(), ...patch },
    updateConfig: vi.fn((nextPatch: Partial<LiveStreamConfig>) => {
      fakeStore.config = { ...fakeStore.config, ...nextPatch };
    }),
  };
}

beforeEach(() => {
  setChatConfig();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('StreamChatPanel', () => {
  it('writes platform immediately and channel after the debounce', () => {
    vi.useFakeTimers();
    render(<StreamChatPanel />);

    fireEvent.change(screen.getByLabelText('Platform'), { target: { value: 'youtube' } });
    expect(fakeStore.updateConfig).toHaveBeenCalledWith({ chatPlatform: 'youtube' });

    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: 'live-video-123' } });
    expect(fakeStore.updateConfig).not.toHaveBeenCalledWith({ chatChannel: 'live-video-123' });
    act(() => { vi.advanceTimersByTime(500); });
    expect(fakeStore.updateConfig).toHaveBeenCalledWith({ chatChannel: 'live-video-123' });
  });

  it('builds the Twitch chat URL with the encoded channel and parent', () => {
    setChatConfig({ chatPlatform: 'twitch', chatChannel: 'my channel' });
    render(<StreamChatPanel />);

    const iframe = screen.getByTitle('Twitch stream chat');
    expect(iframe).toHaveAttribute('src', expect.stringContaining('/embed/my%20channel/chat'));
    expect(iframe).toHaveAttribute('src', expect.stringContaining(`parent=${location.hostname}`));
  });

  it('builds the YouTube live chat URL', () => {
    setChatConfig({ chatPlatform: 'youtube', chatChannel: 'video-id' });
    render(<StreamChatPanel />);

    expect(screen.getByTitle('YouTube stream chat')).toHaveAttribute(
      'src',
      expect.stringContaining('youtube.com/live_chat?v=video-id'),
    );
  });

  it('shows setup guidance without a channel', () => {
    render(<StreamChatPanel />);

    expect(screen.getByText('Connect your stream chat.')).toBeInTheDocument();
    expect(screen.queryByTitle(/stream chat/i)).not.toBeInTheDocument();
  });

  it('sandboxes the embedded chat', () => {
    setChatConfig({ chatChannel: 'masterselects' });
    render(<StreamChatPanel />);

    expect(screen.getByTitle('Twitch stream chat')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-forms',
    );
  });
});
