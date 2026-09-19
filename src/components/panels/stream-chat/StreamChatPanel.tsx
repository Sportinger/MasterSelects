import { useEffect, useMemo, useState } from 'react';

import type { StreamChatPlatform } from '../../../services/liveStream/streamTypes';
import { useStreamStore } from '../../../stores/streamStore';
import './StreamChatPanel.css';

const CHANNEL_DEBOUNCE_MS = 500;

function chatEmbedUrl(platform: StreamChatPlatform, channel: string): string {
  const encodedChannel = encodeURIComponent(channel);
  const hostname = location.hostname;
  return platform === 'youtube'
    ? `https://www.youtube.com/live_chat?v=${encodedChannel}&embed_domain=${hostname}`
    : `https://www.twitch.tv/embed/${encodedChannel}/chat?parent=${hostname}&darkpopout`;
}

export function StreamChatPanel() {
  const platform = useStreamStore(state => state.config.chatPlatform ?? 'twitch');
  const channel = useStreamStore(state => state.config.chatChannel ?? '');
  const updateConfig = useStreamStore(state => state.updateConfig);
  const [channelDraft, setChannelDraft] = useState(channel);
  const [embeddedChannel, setEmbeddedChannel] = useState(channel.trim());

  useEffect(() => {
    setChannelDraft(channel);
    setEmbeddedChannel(channel.trim());
  }, [channel]);

  useEffect(() => {
    if (channelDraft === channel) return undefined;
    const timer = window.setTimeout(() => {
      updateConfig({ chatChannel: channelDraft });
      setEmbeddedChannel(channelDraft.trim());
    }, CHANNEL_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [channel, channelDraft, updateConfig]);

  const iframeUrl = useMemo(
    () => embeddedChannel ? chatEmbedUrl(platform, embeddedChannel) : '',
    [embeddedChannel, platform],
  );
  const channelPlaceholder = platform === 'youtube'
    ? 'YouTube live video id'
    : 'Twitch channel name';

  return (
    <div className="stream-chat-panel">
      <header className="panel-header stream-chat-header">
        <h2>Stream Chat</h2>
        <div className="stream-chat-controls">
          <label>
            <span>Platform</span>
            <select
              value={platform}
              onChange={event => updateConfig({ chatPlatform: event.target.value as StreamChatPlatform })}
            >
              <option value="twitch">Twitch</option>
              <option value="youtube">YouTube</option>
            </select>
          </label>
          <label>
            <span>Channel</span>
            <input
              type="text"
              value={channelDraft}
              placeholder={channelPlaceholder}
              autoComplete="off"
              onChange={event => setChannelDraft(event.target.value)}
            />
          </label>
        </div>
      </header>

      {iframeUrl ? (
        <iframe
          className="stream-chat-frame"
          key={`${platform}:${embeddedChannel}`}
          src={iframeUrl}
          title={`${platform === 'youtube' ? 'YouTube' : 'Twitch'} stream chat`}
          sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
          referrerPolicy="origin"
        />
      ) : (
        <div className="stream-chat-empty">
          <p>Connect your stream chat.</p>
          <span>Choose a platform and enter {platform === 'youtube' ? 'a live video ID' : 'a channel name'} above.</span>
        </div>
      )}
    </div>
  );
}
