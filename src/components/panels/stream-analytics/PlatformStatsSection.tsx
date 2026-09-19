import { useEffect, useMemo, useState } from 'react';
import {
  startTwitchPlatformStatsPolling,
  type TwitchPlatformStats,
  type TwitchPlatformStatsData,
} from '../../../services/liveStream/twitchPlatformStats';
import { useStreamStore } from '../../../stores/streamStore';
import './PlatformStatsSection.css';

const CHANNEL_UPDATE_DEBOUNCE_MS = 500;
const MAX_VIEWER_SAMPLES = 30;
const TWITCH_SECRET_ENV = ['TWITCH_CLIENT', 'SECRET'].join('_');

export function PlatformStatsSection() {
  const chatChannel = useStreamStore(state => state.config.chatChannel);
  const chatPlatform = useStreamStore(state => state.config.chatPlatform);
  const updateConfig = useStreamStore(state => state.updateConfig);
  const [channelDraft, setChannelDraft] = useState(chatChannel ?? '');
  const [channelEdited, setChannelEdited] = useState(false);
  const [stats, setStats] = useState<TwitchPlatformStats | null>(null);
  const [viewerSamples, setViewerSamples] = useState<number[]>([]);
  const [nowMs, setNowMs] = useState(Date.now);

  useEffect(() => {
    if (!channelEdited) setChannelDraft(chatChannel ?? '');
  }, [channelEdited, chatChannel]);

  useEffect(() => {
    if (!channelEdited) return;
    const timer = window.setTimeout(() => {
      updateConfig({ chatChannel: channelDraft.trim(), chatPlatform: 'twitch' });
      setChannelEdited(false);
    }, CHANNEL_UPDATE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [channelDraft, channelEdited, updateConfig]);

  useEffect(() => {
    const channel = (chatChannel ?? '').trim();
    if (chatPlatform !== 'twitch' || !channel) {
      setStats(null);
      setViewerSamples([]);
      return;
    }

    setStats(null);
    setViewerSamples([]);
    return startTwitchPlatformStatsPolling(
      () => channel,
      nextStats => {
        setStats(nextStats);
        if (isStatsData(nextStats) && nextStats.live) {
          setViewerSamples(samples => [...samples, nextStats.viewerCount].slice(-MAX_VIEWER_SAMPLES));
        }
      },
    );
  }, [chatChannel, chatPlatform]);

  useEffect(() => {
    if (!isStatsData(stats) || !stats.live || !stats.startedAt) return;
    const tick = () => setNowMs(Date.now());
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [stats]);

  if (chatPlatform !== 'twitch' || !(chatChannel ?? '').trim()) {
    return (
      <section className="platform-stats-section" aria-label="Twitch platform stats">
        <SectionHeading />
        <div className="platform-stats-setup">
          <p>Add a Twitch channel to show live platform stats.</p>
          <label className="platform-stats-channel-field">
            <span>Twitch channel</span>
            <input
              type="text"
              value={channelDraft}
              placeholder="channel_name"
              autoComplete="off"
              onChange={event => {
                setChannelDraft(event.target.value);
                setChannelEdited(true);
              }}
            />
          </label>
        </div>
      </section>
    );
  }

  return (
    <section className="platform-stats-section" aria-label="Twitch platform stats">
      <SectionHeading />
      {renderStats(stats, viewerSamples, nowMs)}
    </section>
  );
}

function SectionHeading() {
  return (
    <header className="platform-stats-heading">
      <div>
        <h3>Twitch</h3>
        <p>Channel status from Twitch Helix</p>
      </div>
    </header>
  );
}

function renderStats(stats: TwitchPlatformStats | null, samples: number[], nowMs: number) {
  if (stats === null) {
    return <p className="platform-stats-muted">Loading Twitch stats…</p>;
  }
  if (!stats.configured) {
    return (
      <div className="platform-stats-config-card" role="status">
        <strong>Connect a Twitch application</strong>
        <p>
          Set <code>TWITCH_CLIENT_ID</code> and <code>{TWITCH_SECRET_ENV}</code> in <code>.dev.vars</code> locally,
          or add them as Cloudflare Pages secrets in production.
        </p>
        <a href="https://dev.twitch.tv/console/apps" target="_blank" rel="noreferrer">Open Twitch Developer Console</a>
      </div>
    );
  }
  if ('error' in stats) {
    if (stats.error === 'signed_out') {
      return <p className="platform-stats-muted">Sign in to load Twitch stats.</p>;
    }
    if (stats.error === 'rate_limited') {
      return <p className="platform-stats-muted">Waiting for the next Twitch update…</p>;
    }
    return <p className="platform-stats-error" role="status">{stats.message}</p>;
  }
  if (!stats.live) return <OfflineStats stats={stats} />;
  return <LiveStats stats={stats} samples={samples} nowMs={nowMs} />;
}

function LiveStats({ stats, samples, nowMs }: {
  stats: TwitchPlatformStatsData;
  samples: number[];
  nowMs: number;
}) {
  return (
    <div className="platform-stats-live-card">
      <div className="platform-stats-live-topline">
        <span className="platform-stats-live-badge">LIVE</span>
        <span className="platform-stats-uptime">{formatPlatformUptime(stats.startedAt, nowMs)}</span>
      </div>
      <div className="platform-stats-viewers">
        <div>
          <strong>{stats.viewerCount.toLocaleString('en-US')}</strong>
          <span>viewers</span>
        </div>
        <ViewerSparkline samples={samples} />
      </div>
      <div className="platform-stats-stream-copy">
        <strong>{stats.title || 'Untitled stream'}</strong>
        <span>{stats.gameName || 'No category'}</span>
      </div>
    </div>
  );
}

function OfflineStats({ stats }: { stats: TwitchPlatformStatsData }) {
  return (
    <div className="platform-stats-offline-card">
      {stats.profileImageUrl && <img src={stats.profileImageUrl} alt="" />}
      <div>
        <strong>{stats.displayName}</strong>
        <span>offline</span>
      </div>
    </div>
  );
}

function ViewerSparkline({ samples }: { samples: number[] }) {
  const points = useMemo(() => sparklinePoints(samples, 116, 30), [samples]);
  return (
    <svg className="platform-stats-sparkline" viewBox="0 0 116 30" aria-hidden="true" preserveAspectRatio="none">
      <polyline points={points} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function sparklinePoints(samples: number[], width: number, height: number): string {
  if (samples.length === 0) return '';
  const maximum = Math.max(1, ...samples);
  return samples.map((value, index) => {
    const x = samples.length === 1 ? width / 2 : (index / (samples.length - 1)) * width;
    const y = height - (Math.max(0, value) / maximum) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function formatPlatformUptime(startedAt: string | null, nowMs: number): string {
  const startedAtMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const totalSeconds = Number.isFinite(startedAtMs)
    ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000))
    : 0;
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function isStatsData(stats: TwitchPlatformStats | null): stats is TwitchPlatformStatsData {
  return Boolean(stats?.configured && !('error' in stats));
}
