import { Logger } from '../logger';

const log = Logger.create('TwitchPlatformStats');
const POLL_INTERVAL_MS = 30_000;

export interface TwitchPlatformStatsData {
  configured: true;
  channel: string;
  displayName: string;
  profileImageUrl: string;
  live: boolean;
  viewerCount: number;
  title: string | null;
  gameName: string | null;
  startedAt: string | null;
}

export interface TwitchNotConfiguredStats {
  configured: false;
}

export interface TwitchPlatformStatsError {
  configured: true;
  error: 'invalid_channel' | 'not_found' | 'twitch_unavailable';
  message: string;
  channel?: string;
  status?: number | null;
}

export interface TwitchSignedOutStats {
  configured: true;
  error: 'signed_out';
  message: string;
}

export interface TwitchRateLimitedStats {
  configured: true;
  error: 'rate_limited';
  keepLastValue: true;
}

export type TwitchPlatformStats =
  | TwitchPlatformStatsData
  | TwitchNotConfiguredStats
  | TwitchPlatformStatsError
  | TwitchSignedOutStats
  | TwitchRateLimitedStats;

export interface TwitchPlatformStatsFetchDeps {
  fetch?: typeof fetch;
}

export interface TwitchPlatformStatsPollingDeps extends TwitchPlatformStatsFetchDeps {
  clearInterval?: (handle: unknown) => void;
  getVisibilityState?: () => string;
  setInterval?: (callback: () => void, delayMs: number) => unknown;
}

export async function fetchTwitchPlatformStats(
  channel: string,
  deps: TwitchPlatformStatsFetchDeps = {},
): Promise<TwitchPlatformStats> {
  try {
    const response = await (deps.fetch ?? fetch)(
      `/api/stream/twitch-stats?channel=${encodeURIComponent(channel.trim())}`,
      { headers: { Accept: 'application/json' } },
    );
    if (response.status === 401) {
      return { configured: true, error: 'signed_out', message: 'Sign in to load Twitch stats.' };
    }
    if (response.status === 429) {
      return { configured: true, error: 'rate_limited', keepLastValue: true };
    }

    const payload = await response.json().catch(() => null);
    if (isTwitchPlatformStats(payload)) return payload;
    return {
      configured: true,
      error: 'twitch_unavailable',
      message: `Twitch stats request failed (${response.status}): invalid response.`,
      status: response.status,
    };
  } catch {
    log.warn('Twitch platform stats request failed: network error.');
    return {
      configured: true,
      error: 'twitch_unavailable',
      message: 'Twitch stats request failed: network error.',
      status: null,
    };
  }
}

export function startTwitchPlatformStatsPolling(
  getChannel: () => string,
  onUpdate: (stats: TwitchPlatformStats) => void,
  deps: TwitchPlatformStatsPollingDeps = {},
): () => void {
  const setTimer = deps.setInterval ?? ((callback, delayMs) => globalThis.setInterval(callback, delayMs));
  const clearTimer = deps.clearInterval ?? (handle => globalThis.clearInterval(handle as number));
  const visibility = deps.getVisibilityState ?? (() => (
    typeof document === 'undefined' ? 'visible' : document.visibilityState
  ));
  let stopped = false;
  let inFlight = false;

  const poll = async (): Promise<void> => {
    if (stopped || inFlight || visibility() === 'hidden') return;
    inFlight = true;
    try {
      const stats = await fetchTwitchPlatformStats(getChannel(), deps);
      if (!stopped && !isKeepLastValue(stats)) onUpdate(stats);
    } finally {
      inFlight = false;
    }
  };

  void poll();
  const interval = setTimer(() => { void poll(); }, POLL_INTERVAL_MS);
  return () => {
    if (stopped) return;
    stopped = true;
    clearTimer(interval);
  };
}

function isKeepLastValue(stats: TwitchPlatformStats): stats is TwitchRateLimitedStats {
  return 'error' in stats && stats.error === 'rate_limited';
}

function isTwitchPlatformStats(value: unknown): value is TwitchPlatformStats {
  if (!value || typeof value !== 'object' || !('configured' in value)) return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.configured === false) return true;
  if (candidate.configured !== true) return false;
  if (typeof candidate.error === 'string') {
    if (candidate.error === 'rate_limited') return candidate.keepLastValue === true;
    return ['invalid_channel', 'not_found', 'twitch_unavailable', 'signed_out'].includes(candidate.error)
      && typeof candidate.message === 'string';
  }
  return typeof candidate.channel === 'string'
    && typeof candidate.displayName === 'string'
    && typeof candidate.profileImageUrl === 'string'
    && typeof candidate.live === 'boolean'
    && typeof candidate.viewerCount === 'number'
    && (typeof candidate.title === 'string' || candidate.title === null)
    && (typeof candidate.gameName === 'string' || candidate.gameName === null)
    && (typeof candidate.startedAt === 'string' || candidate.startedAt === null);
}
