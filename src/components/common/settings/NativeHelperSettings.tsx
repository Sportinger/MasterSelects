import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import { NativeHelperClient, isNativeHelperAvailable } from '../../../services/nativeHelper';
import type { SystemInfo, ConnectionStatus } from '../../../services/nativeHelper';
import {
  fetchLatestPublishedNativeHelperRelease,
  NATIVE_HELPER_RELEASES_URL,
  NATIVE_HELPER_TARGET_VERSION,
  type NativeHelperPublishedRelease,
} from '../../../services/nativeHelper/releases';
import { useSettingsStore } from '../../../stores/settingsStore';

type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

type ExtendedSystemInfo = SystemInfo & {
  ytdlp_available?: boolean;
  fs_commands?: boolean;
  ai_bridge?: boolean;
  matanyone_available?: boolean;
  matanyone_status?: string;
};

const NATIVE_HELPER_VERSION = NATIVE_HELPER_TARGET_VERSION;

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function getInstallSteps(platform: Platform): { steps: string[]; command?: string } {
  switch (platform) {
    case 'windows':
      return {
        steps: [
          'Download the newest MSI from GitHub releases.',
          'Run the installer and keep the helper running in the system tray.',
          'Return here and press Check connection.',
        ],
      };
    case 'mac':
      return {
        steps: [
          'Download the current helper build from the release page.',
          'Move the app to Applications and launch it once.',
          'Keep the menu bar app running while using MasterSelects.',
        ],
        command: 'brew install yt-dlp',
      };
    case 'linux':
      return {
        steps: [
          'Download and extract the helper binary from the release page.',
          'Launch the binary and keep it running.',
        ],
        command: 'sudo apt install yt-dlp || pip install yt-dlp',
      };
    default:
      return {
        steps: [
          'Download the helper from GitHub releases.',
          'Install, launch, and press Check connection.',
        ],
      };
  }
}

type CapTone = 'good' | 'warn' | 'neutral';

function CapPill({ children, tone = 'neutral' }: { children: ReactNode; tone?: CapTone }) {
  const bg: Record<CapTone, string> = {
    good: 'rgba(34,197,94,0.15)',
    warn: 'rgba(250,204,21,0.15)',
    neutral: 'rgba(255,255,255,0.06)',
  };
  const color: Record<CapTone, string> = {
    good: '#4ade80',
    warn: '#fbbf24',
    neutral: 'var(--text-secondary)',
  };

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 500,
        background: bg[tone],
        color: color[tone],
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

export function NativeHelperSettings() {
  const {
    turboModeEnabled,
    nativeHelperPort,
    nativeHelperConnected,
    setTurboModeEnabled,
    setNativeHelperPort,
    setNativeHelperConnected,
  } = useSettingsStore();

  const [status, setStatus] = useState<ConnectionStatus>(nativeHelperConnected ? 'connected' : 'disconnected');
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [publishedRelease, setPublishedRelease] = useState<NativeHelperPublishedRelease | null>(null);
  const [showInstall, setShowInstall] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);

  const helperEnabled = turboModeEnabled;
  const platform = useMemo(() => detectPlatform(), []);
  const installInfo = useMemo(() => getInstallSteps(platform), [platform]);
  const helperInfo = status === 'connected' ? (info as ExtendedSystemInfo | null) : null;

  const checkConnection = useCallback(async () => {
    if (!helperEnabled) {
      setStatus('disconnected');
      setNativeHelperConnected(false);
      return;
    }
    setChecking(true);
    try {
      const available = await isNativeHelperAvailable();
      setStatus(available ? 'connected' : 'disconnected');
      setNativeHelperConnected(available);
    } catch {
      setStatus('disconnected');
      setNativeHelperConnected(false);
    }
    setChecking(false);
  }, [helperEnabled, setNativeHelperConnected]);

  useEffect(() => {
    queueMicrotask(() => void checkConnection());
    const unsub = NativeHelperClient.onStatusChange((s) => {
      setStatus(s);
      setNativeHelperConnected(s === 'connected');
    });
    return unsub;
  }, [checkConnection, setNativeHelperConnected]);

  useEffect(() => {
    if (status === 'connected') {
      NativeHelperClient.getInfo().then(setInfo).catch(() => setInfo(null));
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void fetchLatestPublishedNativeHelperRelease().then((r) => {
      if (!cancelled) setPublishedRelease(r);
    });
    return () => { cancelled = true; };
  }, []);

  const isConnected = status === 'connected';
  const connectedVersion = helperInfo?.version ?? null;
  const publishedVersion = publishedRelease?.version ?? null;
  const expectedVersionInstalled = connectedVersion === NATIVE_HELPER_VERSION;
  const downloadLink = publishedRelease?.url || NATIVE_HELPER_RELEASES_URL;

  const capabilities: Array<{ label: string; tone: CapTone }> = isConnected && helperInfo
    ? [
        { label: helperInfo.ytdlp_available ? 'Downloads ready' : 'yt-dlp missing', tone: helperInfo.ytdlp_available ? 'good' : 'warn' },
        { label: helperInfo.fs_commands ? 'Projects ready' : 'Projects unavailable', tone: helperInfo.fs_commands ? 'good' : 'warn' },
        { label: helperInfo.ai_bridge ? 'AI bridge ready' : 'AI bridge unavailable', tone: helperInfo.ai_bridge ? 'good' : 'warn' },
        { label: helperInfo.matanyone_available ? 'MatAnyone2 ready' : 'MatAnyone2 N/A', tone: helperInfo.matanyone_available ? 'good' : 'neutral' },
      ]
    : [
        { label: 'Downloads', tone: 'neutral' },
        { label: 'Firefox projects', tone: 'neutral' },
        { label: 'AI bridge', tone: 'neutral' },
        { label: 'MatAnyone2', tone: 'neutral' },
      ];

  return (
    <div className="settings-category-content">
      <h2>Native Helper</h2>

      {/* Enable toggle */}
      <div className="settings-group">
        <div className="settings-group-title">Connection</div>

        <label className="settings-row">
          <span className="settings-label">Enable Native Helper</span>
          <input
            type="checkbox"
            checked={helperEnabled}
            onChange={(e) => setTurboModeEnabled(e.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          Required for downloads, Firefox projects, and the AI bridge.
        </p>

        <label className="settings-row" style={{ marginTop: 4 }}>
          <span className="settings-label">WebSocket Port</span>
          <input
            type="number"
            value={nativeHelperPort}
            onChange={(e) => setNativeHelperPort(Number(e.target.value))}
            className="settings-input settings-input-number"
            min={1024}
            max={65535}
            disabled={!helperEnabled}
          />
        </label>

        <div className="settings-status" style={{ marginTop: 4 }}>
          <span className={`status-indicator ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="status-text">
            {isConnected
              ? (connectedVersion ? `Connected  -  v${connectedVersion}` : 'Connected')
              : (helperEnabled ? 'Not running' : 'Disabled')}
          </span>
        </div>
      </div>

      {/* Version & capabilities */}
      <div className="settings-group">
        <div className="settings-group-title">
          {isConnected ? 'Session' : 'Release info'}
        </div>

        {/* Version row */}
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <span className="settings-label" style={{ flex: 1 }}>
              {isConnected && connectedVersion
                ? `Helper v${connectedVersion}`
                : publishedVersion
                  ? `GitHub release v${publishedVersion}`
                  : 'Native Helper'}
            </span>
            <CapPill tone={isConnected ? (expectedVersionInstalled ? 'good' : 'warn') : 'neutral'}>
              {isConnected
                ? (expectedVersionInstalled ? 'Up to date' : 'Update available')
                : (helperEnabled ? 'Waiting...' : 'Disabled')}
            </CapPill>
          </div>

          {isConnected && publishedVersion && publishedVersion !== NATIVE_HELPER_VERSION && (
            <p className="settings-hint" style={{ margin: 0 }}>
              GitHub publishes v{publishedVersion}, app targets v{NATIVE_HELPER_VERSION}.
            </p>
          )}
        </div>

        {/* Capability pills */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '6px 0' }}>
          {capabilities.map((cap) => (
            <CapPill key={cap.label} tone={cap.tone}>{cap.label}</CapPill>
          ))}
        </div>

        {/* Version pills */}
        {publishedVersion && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, paddingBottom: 6 }}>
            <CapPill tone={publishedVersion === NATIVE_HELPER_VERSION ? 'good' : 'warn'}>
              Public GitHub: v{publishedVersion}
            </CapPill>
            {publishedVersion !== NATIVE_HELPER_VERSION && (
              <CapPill tone="neutral">App target: v{NATIVE_HELPER_VERSION}</CapPill>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
          <a
            href={downloadLink}
            target="_blank"
            rel="noopener noreferrer"
            className="settings-button"
            style={{ textDecoration: 'none', textAlign: 'center' }}
          >
            Open releases
          </a>
          <button
            className="settings-button"
            onClick={() => void checkConnection()}
            disabled={checking}
          >
            {checking ? 'Checking...' : 'Check connection'}
          </button>
        </div>
      </div>

      {/* Install guide */}
      <div className="settings-group">
        <button
          className="settings-row"
          onClick={() => setShowInstall((v) => !v)}
          style={{
            cursor: 'pointer',
            background: 'none',
            border: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            width: '100%',
            padding: '4px 0',
          }}
        >
          <span className="settings-label">
            {platform === 'windows' ? 'How to install on Windows'
              : platform === 'mac' ? 'How to install on macOS'
                : platform === 'linux' ? 'How to install on Linux'
                  : 'How to install'}
          </span>
          <svg
            width="12" height="12" viewBox="0 0 12 12" fill="none"
            style={{ transform: showInstall ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>

        {showInstall && (
          <div style={{ padding: '6px 0' }}>
            <ol style={{ margin: 0, paddingLeft: 18, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {installInfo.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            {installInfo.command && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <code style={{
                  flex: 1,
                  padding: '4px 8px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 3,
                  fontSize: 10,
                  color: 'var(--text-primary)',
                  fontFamily: 'monospace',
                }}>
                  {installInfo.command}
                </code>
                <button
                  className="settings-button"
                  onClick={() => {
                    void navigator.clipboard.writeText(installInfo.command!);
                    setCopiedCmd(true);
                    setTimeout(() => setCopiedCmd(false), 1400);
                  }}
                  style={{ fontSize: 10, padding: '3px 8px' }}
                >
                  {copiedCmd ? 'Copied' : 'Copy'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
