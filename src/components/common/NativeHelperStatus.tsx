/**
 * Native Helper Status Component
 *
 * Shows connection status in toolbar and opens a dialog for details/download.
 */

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import './WelcomeOverlay.css';
import './NativeHelperStatus.css';
import { NativeHelperClient, isNativeHelperAvailable } from '../../services/nativeHelper';
import type { SystemInfo, ConnectionStatus } from '../../services/nativeHelper';
import {
  compareNativeHelperVersions,
  fetchLatestPublishedNativeHelperRelease,
  NATIVE_HELPER_RELEASES_URL,
  NATIVE_HELPER_TARGET_VERSION,
  type NativeHelperPublishedRelease,
} from '../../services/nativeHelper/releases';
import { useSettingsStore } from '../../stores/settingsStore';

type Platform = 'mac' | 'windows' | 'linux' | 'unknown';

type ExtendedSystemInfo = SystemInfo & {
  ytdlp_available?: boolean;
  fs_commands?: boolean;
  ai_bridge?: boolean;
  matanyone_available?: boolean;
  matanyone_status?: string;
};

type InstallGuide = {
  title: string;
  steps: string[];
  note?: string;
  command?: string;
};

type PillTone = 'neutral' | 'good' | 'warn';

const NATIVE_HELPER_VERSION = NATIVE_HELPER_TARGET_VERSION;
const NATIVE_HELPER_RELEASES = NATIVE_HELPER_RELEASES_URL;
const DOWNLOAD_LINKS = {
  windows: NATIVE_HELPER_RELEASES,
  mac: NATIVE_HELPER_RELEASES,
  linux: NATIVE_HELPER_RELEASES,
} as const;

type NativeHelperStatusProps = {
  variant?: 'toolbar' | 'info';
};

function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'mac';
  if (ua.includes('win')) return 'windows';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function getInstallGuide(platform: Platform): InstallGuide {
  switch (platform) {
    case 'windows':
      return {
        title: 'How to install on Windows',
        steps: [
          'Open the GitHub releases page and download the newest published MSI.',
          'Run the installer and keep the helper running in the system tray.',
          'Return to MasterSelects and press Check connection.',
        ],
        note: 'The current helper release includes downloads, Firefox project save/open, and the local AI bridge.',
      };
    case 'mac':
      return {
        title: 'How to install on macOS',
        steps: [
          'Open the release page and download the current helper build.',
          'Move the app to Applications and launch it once.',
          'Keep the menu bar app running while using MasterSelects.',
        ],
        command: 'brew install yt-dlp',
      };
    case 'linux':
      return {
        title: 'How to install on Linux',
        steps: [
          'Open the release page and download the current helper build.',
          'Extract the archive and launch the helper binary.',
          'Keep the helper process running while using MasterSelects.',
        ],
        command: 'sudo apt install yt-dlp || pip install yt-dlp',
      };
    default:
      return {
        title: 'How to install',
        steps: [
          'Open the release page for the latest helper build.',
          'Install and launch the helper on the same machine as MasterSelects.',
          'Return here and press Check connection.',
        ],
      };
  }
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function LightningIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={active ? '#facc15' : '#6b7280'} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}>
      <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusPill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: PillTone;
}) {
  return (
    <span className={`native-helper-pill native-helper-pill-${tone}`}>
      {children}
    </span>
  );
}

/**
 * Toolbar button that shows helper status
 */
export function NativeHelperStatus({ variant = 'toolbar' }: NativeHelperStatusProps) {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [showDialog, setShowDialog] = useState(false);

  const {
    turboModeEnabled,
    nativeHelperPort,
    nativeDecodeEnabled,
    setNativeDecodeEnabled,
    setNativeHelperConnected,
  } = useSettingsStore();

  const helperEnabled = turboModeEnabled;

  const checkConnection = useCallback(async () => {
    if (!helperEnabled) {
      setStatus('disconnected');
      setNativeHelperConnected(false);
      return;
    }

    try {
      NativeHelperClient.configure({ port: nativeHelperPort });
      const available = await isNativeHelperAvailable();
      setStatus(available ? 'connected' : 'disconnected');
      setNativeHelperConnected(available);
    } catch {
      setStatus('disconnected');
      setNativeHelperConnected(false);
    }
  }, [helperEnabled, nativeHelperPort, setNativeHelperConnected]);

  useEffect(() => {
    if (nativeDecodeEnabled) {
      setNativeDecodeEnabled(false);
    }
  }, [nativeDecodeEnabled, setNativeDecodeEnabled]);

  useEffect(() => {
    queueMicrotask(() => void checkConnection());

    const unsubscribe = NativeHelperClient.onStatusChange((newStatus) => {
      setStatus(newStatus);
      setNativeHelperConnected(newStatus === 'connected');
    });

    const interval = setInterval(() => void checkConnection(), 30000);

    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, [checkConnection, setNativeHelperConnected]);

  const isConnected = status === 'connected';
  const statusTone = isConnected ? 'connected' : helperEnabled ? 'offline' : 'disabled';
  const statusLabel = isConnected ? 'Connected' : helperEnabled ? 'Not running' : 'Disabled';
  const helperSummary = isConnected
    ? 'Downloads, Firefox projects, and the AI bridge are ready.'
    : 'Open the helper panel for status, download links, and setup.';

  return (
    <>
      {variant === 'toolbar' ? (
        <button
          onClick={() => setShowDialog(true)}
          className="p-1 rounded hover:bg-white/10 transition-colors"
          title={isConnected ? 'Native Helper connected' : 'Native Helper'}
          style={{ background: 'transparent', lineHeight: 1 }}
        >
          <LightningIcon active={isConnected} />
        </button>
      ) : (
        <button
          type="button"
          className="info-helper-launch"
          onClick={() => setShowDialog(true)}
        >
          <span className="info-helper-launch-icon">
            <LightningIcon active={isConnected} />
          </span>
          <span className="info-helper-launch-copy">
            <span className="info-helper-launch-header">
              <span className="info-helper-launch-title">Native Helper</span>
              <span className={`info-helper-launch-badge info-helper-launch-badge-${statusTone}`}>
                {statusLabel}
              </span>
            </span>
            <span className="info-helper-launch-text">{helperSummary}</span>
          </span>
        </button>
      )}

      {showDialog && (
        <NativeHelperDialog
          status={status}
          onClose={() => setShowDialog(false)}
          onRetry={checkConnection}
        />
      )}
    </>
  );
}

function NativeHelperDialog({
  status,
  onClose,
  onRetry,
}: {
  status: ConnectionStatus;
  onClose: () => void;
  onRetry: () => void;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [publishedRelease, setPublishedRelease] = useState<NativeHelperPublishedRelease | null>(null);

  const {
    turboModeEnabled,
    setTurboModeEnabled,
  } = useSettingsStore();

  const helperEnabled = turboModeEnabled;
  const platform = useMemo(() => detectPlatform(), []);
  const installGuide = useMemo(() => getInstallGuide(platform), [platform]);
  const helperInfo = status === 'connected' ? (info as ExtendedSystemInfo | null) : null;

  useEffect(() => {
    if (status === 'connected') {
      let cancelled = false;
      NativeHelperClient.getInfo(3000)
        .then((nextInfo) => {
          if (!cancelled) setInfo(nextInfo);
        })
        .catch(() => {
          if (!cancelled) setInfo(null);
        });
      return () => {
        cancelled = true;
      };
    }
  }, [status]);

  useEffect(() => {
    let cancelled = false;
    void fetchLatestPublishedNativeHelperRelease().then((release) => {
      if (!cancelled) {
        setPublishedRelease(release);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    setTimeout(onClose, 150);
  }, [onClose, isClosing]);

  const handleRetry = useCallback(async () => {
    setChecking(true);
    await onRetry();
    setChecking(false);
  }, [onRetry]);

  const handleCopyCommand = useCallback(async (command: string) => {
    const copied = await copyText(command);
    if (!copied) return;
    setCopiedCommand(command);
    window.setTimeout(() => {
      setCopiedCommand((current) => (current === command ? null : current));
    }, 1400);
  }, []);

  useEffect(() => {
    if (helperEnabled && status !== 'connected') {
      queueMicrotask(() => void handleRetry());
    }
  }, [handleRetry, helperEnabled, status]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) handleClose();
  };

  const isConnected = status === 'connected';
  const downloadLink = publishedRelease?.url || ((platform !== 'unknown' && DOWNLOAD_LINKS[platform]) || NATIVE_HELPER_RELEASES);
  const connectedVersion = helperInfo?.version ?? null;
  const publishedVersion = publishedRelease?.version ?? null;
  const versionKnown = connectedVersion !== null;
  const helperVersionCompare = compareNativeHelperVersions(connectedVersion, NATIVE_HELPER_VERSION);
  const expectedVersionInstalled = versionKnown && helperVersionCompare >= 0;
  const helperNeedsUpdate = isConnected && versionKnown && helperVersionCompare < 0;
  const publishedMatchesTarget = compareNativeHelperVersions(publishedVersion, NATIVE_HELPER_VERSION) >= 0;
  const statusTone = isConnected ? 'connected' : helperEnabled ? 'offline' : 'disabled';
  const statusLabel = isConnected ? 'Connected' : helperEnabled ? 'Not running' : 'Disabled';

  const capabilityPills: Array<{ label: string; tone: PillTone }> = isConnected && helperInfo
    ? [
        { label: connectedVersion ? `Installed v${connectedVersion}` : 'Connected', tone: helperNeedsUpdate ? 'warn' : 'good' },
        { label: helperInfo.ytdlp_available ? 'Downloads ready' : 'yt-dlp missing', tone: helperInfo.ytdlp_available ? 'good' : 'warn' },
        { label: helperInfo.fs_commands ? 'Projects ready' : 'Projects unavailable', tone: helperInfo.fs_commands ? 'good' : 'warn' },
        { label: helperInfo.ai_bridge ? 'AI bridge ready' : 'AI bridge unavailable', tone: helperInfo.ai_bridge ? 'good' : 'warn' },
        { label: helperInfo.matanyone_available ? 'MatAnyone2 ready' : helperInfo.matanyone_status === 'installed' ? 'MatAnyone2 installed' : 'MatAnyone2 not installed', tone: helperInfo.matanyone_available ? 'good' : 'neutral' },
      ]
    : [
        { label: 'Downloads', tone: 'neutral' },
        { label: 'Firefox projects', tone: 'neutral' },
        { label: 'AI bridge', tone: 'neutral' },
        { label: 'MatAnyone2', tone: 'neutral' },
      ];

  return (
    <div
      className="welcome-overlay-backdrop"
      onClick={handleBackdropClick}
      style={{
        animation: 'none',
        opacity: isClosing ? 0 : 1,
        transition: 'opacity 150ms ease-out',
      }}
    >
      <div
        className="welcome-overlay native-helper-dialog"
        style={{
          animation: 'none',
          opacity: isClosing ? 0 : 1,
          transform: isClosing ? 'scale(0.97)' : 'none',
          transition: 'opacity 150ms ease-out, transform 150ms ease-out',
        }}
      >
        <div className="native-helper-dialog-header">
          <div className="native-helper-title-row">
            <div>
              <div className={`native-helper-status-pill native-helper-status-pill-${statusTone}`}>
                <span className="native-helper-status-dot" />
                <span>{statusLabel}</span>
              </div>
              <h1 className="native-helper-title">Native Helper</h1>
            </div>
            <span className="native-helper-version-pill">v{NATIVE_HELPER_VERSION}</span>
          </div>
          <p className="native-helper-subtitle">
            Downloads, Firefox project save/open, and local AI bridge access.
          </p>
        </div>

        <div className="native-helper-dialog-body">
          <div className="native-helper-card">
            <label className="native-helper-toggle-row">
              <input
                type="checkbox"
                checked={helperEnabled}
                onChange={(e) => setTurboModeEnabled(e.target.checked)}
                className="native-helper-checkbox"
              />
              <span className="native-helper-toggle-text">
                <span className="native-helper-toggle-title">Enable Native Helper</span>
                <span className="native-helper-toggle-description">
                  Required for downloads, Firefox projects, and the AI bridge.
                </span>
              </span>
            </label>
          </div>

          <div className="native-helper-card native-helper-card-highlight">
            <div className="native-helper-card-head">
              <div>
                <div className="native-helper-card-kicker">
                  {isConnected ? 'Connected session' : 'Published release'}
                </div>
                <div className="native-helper-card-title">
                  {isConnected
                    ? (connectedVersion ? `Helper v${connectedVersion}` : 'Helper connected')
                    : publishedVersion
                      ? `GitHub release v${publishedVersion}`
                      : 'Native Helper releases'}
                </div>
              </div>
              <span className={`native-helper-chip ${helperNeedsUpdate ? 'is-warn' : ''}`}>
              {isConnected
                ? (versionKnown ? (expectedVersionInstalled ? 'Up to date' : 'Update available') : 'Connected')
                : (helperEnabled ? 'Waiting for helper' : 'Helper disabled')}
              </span>
            </div>

            <p className="native-helper-card-note">
              {isConnected
                ? (
                  publishedVersion && !publishedMatchesTarget
                    ? `The helper is reachable from MasterSelects. GitHub still only publishes v${publishedVersion}, while this app build already targets v${NATIVE_HELPER_VERSION}.`
                    : 'The helper is reachable from MasterSelects on this machine.'
                )
                : (
                  publishedVersion && !publishedMatchesTarget
                    ? `GitHub currently only has v${publishedVersion} published. MasterSelects already targets helper v${NATIVE_HELPER_VERSION}, but that release is not public yet.`
                    : 'Install the current helper build and keep it running in the background.'
                )}
            </p>

            <div className="native-helper-pill-row">
              {capabilityPills.map((pill) => (
                <StatusPill key={pill.label} tone={pill.tone}>
                  {pill.label}
                </StatusPill>
              ))}
              {publishedVersion && (
                <StatusPill tone={publishedMatchesTarget ? 'good' : 'warn'}>
                  Public GitHub: v{publishedVersion}
                </StatusPill>
              )}
              {publishedVersion && !publishedMatchesTarget && (
                <StatusPill tone="neutral">
                  App target: v{NATIVE_HELPER_VERSION}
                </StatusPill>
              )}
            </div>

            <div className="native-helper-action-row">
              <a
                href={downloadLink}
                target="_blank"
                rel="noopener noreferrer"
                className="native-helper-button native-helper-button-primary"
              >
                Open Native Helper releases
              </a>
              <button
                onClick={() => void handleRetry()}
                disabled={checking}
                className="native-helper-button native-helper-button-secondary"
              >
                {checking ? 'Checking...' : 'Check connection'}
              </button>
            </div>

            <a
              href={NATIVE_HELPER_RELEASES}
              target="_blank"
              rel="noopener noreferrer"
              className="native-helper-link"
            >
              Open release page
            </a>
          </div>

          <div className="native-helper-accordion">
            <button
              className="native-helper-accordion-toggle"
              onClick={() => setShowInstallGuide((value) => !value)}
            >
              <span>{installGuide.title}</span>
              <ChevronIcon open={showInstallGuide} />
            </button>

            {showInstallGuide && (
              <div className="native-helper-accordion-body">
                <ol className="native-helper-install-list">
                  {installGuide.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>

                {installGuide.note && (
                  <p className="native-helper-install-note">{installGuide.note}</p>
                )}

                {installGuide.command && (
                  <div className="native-helper-command-row">
                    <code className="native-helper-command">{installGuide.command}</code>
                    <button
                      onClick={() => void handleCopyCommand(installGuide.command!)}
                      className="native-helper-copy-button"
                    >
                      {copiedCommand === installGuide.command ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="native-helper-footer">
          <button className="welcome-enter" onClick={handleClose}>
            <span>Close</span>
            <kbd>Esc</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

export default NativeHelperStatus;
