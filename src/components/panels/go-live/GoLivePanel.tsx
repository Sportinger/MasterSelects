import { useEffect, useMemo, useState } from 'react';
import { useStreamStore } from '../../../stores/streamStore';
import type {
  LiveStreamConfig,
  RtmpRelayMode,
  StreamFps,
  StreamResolutionPreset,
  StreamStoreApi,
  StreamTransport,
} from '../../../services/liveStream/streamTypes';
import './GoLivePanel.css';

function formatUptime(startedAtMs: number | null, nowMs: number): string {
  const seconds = startedAtMs === null ? 0 : Math.max(0, Math.floor((nowMs - startedAtMs) / 1_000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function clampLevel(level: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0));
}

function SecretField({
  label,
  revealed,
  value,
  onChange,
  onToggleReveal,
}: {
  label: string;
  revealed: boolean;
  value: string;
  onChange: (value: string) => void;
  onToggleReveal: () => void;
}) {
  return (
    <label className="go-live-field go-live-secret-field">
      <span>{label}</span>
      <span className="go-live-secret-control">
        <input type={revealed ? 'text' : 'password'} value={value} onChange={event => onChange(event.target.value)} autoComplete="off" />
        <button type="button" onClick={onToggleReveal} aria-label={`${revealed ? 'Hide' : 'Reveal'} ${label.toLowerCase()}`}>
          {revealed ? 'Hide' : 'Show'}
        </button>
      </span>
    </label>
  );
}

export function GoLivePanel() {
  const config = useStreamStore((state: StreamStoreApi) => state.config);
  const status = useStreamStore((state: StreamStoreApi) => state.status);
  const updateConfig = useStreamStore((state: StreamStoreApi) => state.updateConfig);
  const goLive = useStreamStore((state: StreamStoreApi) => state.goLive);
  const endStream = useStreamStore((state: StreamStoreApi) => state.endStream);
  const refreshHelperAvailability = useStreamStore((state: StreamStoreApi) => state.refreshHelperAvailability);
  const [showRtmpKey, setShowRtmpKey] = useState(false);
  const [showWhipToken, setShowWhipToken] = useState(false);
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [nowMs, setNowMs] = useState(Date.now);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => { void refreshHelperAvailability(); }, [refreshHelperAvailability]);

  useEffect(() => {
    if (status.phase !== 'live' || status.startedAtMs === null) return;
    const updateClock = () => setNowMs(Date.now());
    const initialTimer = window.setTimeout(updateClock, 0);
    const interval = window.setInterval(updateClock, 1_000);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
    };
  }, [status.phase, status.startedAtMs]);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) return;
    let active = true;
    const refreshDevices = () => {
      void navigator.mediaDevices.enumerateDevices().then(devices => {
        if (active) setMicrophones(devices.filter(device => device.kind === 'audioinput'));
      }).catch(() => {
        if (active) setMicrophones([]);
      });
    };
    refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    };
  }, []);

  const locked = status.phase === 'starting' || status.phase === 'live' || status.phase === 'stopping';
  const rtmpRelay = config.rtmpRelay ?? 'auto';
  const requiredFieldsPresent = config.transport === 'rtmp'
    ? config.rtmpUrl.trim().length > 0
      && config.rtmpStreamKey.trim().length > 0
      && (rtmpRelay !== 'helper' || status.helperAvailable)
    : config.whipUrl.trim().length > 0;
  const actionDisabled = status.phase === 'starting' || status.phase === 'stopping' || (!locked && !requiredFieldsPresent);
  const visibleError = status.phase === 'error' && status.lastError !== null && status.lastError !== dismissedError;
  const uptime = useMemo(() => formatUptime(status.startedAtMs, nowMs), [nowMs, status.startedAtMs]);
  const patch = (next: Partial<LiveStreamConfig>) => updateConfig(next);

  return (
    <div className="go-live-panel">
      <header className="panel-header go-live-header">
        <div>
          <h2>Go Live</h2>
          <p>Send the program output to an RTMP or WHIP destination.</p>
        </div>
        <span className={`go-live-phase go-live-phase-${status.phase}`}>{status.phase}</span>
      </header>

      {visibleError && (
        <div className="go-live-error" role="alert">
          <span>{status.lastError}</span>
          <button type="button" onClick={() => setDismissedError(status.lastError)}>Dismiss</button>
        </div>
      )}

      <fieldset className="go-live-section" disabled={locked}>
        <legend>Destination</legend>
        <label className="go-live-field">
          <span>Transport</span>
          <select value={config.transport} onChange={event => patch({ transport: event.target.value as StreamTransport })}>
            <option value="rtmp">RTMP</option>
            <option value="whip">WHIP direct</option>
          </select>
        </label>
        {config.transport === 'rtmp' ? (
          <>
            <label className="go-live-field">
              <span>Relay</span>
              <select value={rtmpRelay} onChange={event => patch({ rtmpRelay: event.target.value as RtmpRelayMode })}>
                <option value="auto">Auto — helper when connected</option>
                <option value="helper">Local helper</option>
                <option value="cloud">Cloud</option>
              </select>
            </label>
            <label className="go-live-field">
              <span>RTMP URL</span>
              <input type="url" value={config.rtmpUrl} onChange={event => patch({ rtmpUrl: event.target.value })} placeholder="rtmp://host/app" />
            </label>
            <SecretField
              label="Stream key"
              revealed={showRtmpKey}
              value={config.rtmpStreamKey}
              onChange={value => patch({ rtmpStreamKey: value })}
              onToggleReveal={() => setShowRtmpKey(value => !value)}
            />
            {rtmpRelay === 'helper' && !status.helperAvailable && (
              <p className="go-live-hint go-live-hint-warning">Native Helper not connected — RTMP needs the helper</p>
            )}
            {(rtmpRelay === 'cloud' || (rtmpRelay === 'auto' && !status.helperAvailable)) && (
              <p className="go-live-hint">Streaming via cloud relay (sign-in required)</p>
            )}
          </>
        ) : (
          <>
            <label className="go-live-field">
              <span>WHIP URL</span>
              <input type="url" value={config.whipUrl} onChange={event => patch({ whipUrl: event.target.value })} placeholder="https://host/whip" />
            </label>
            <SecretField
              label="Bearer token"
              revealed={showWhipToken}
              value={config.whipBearerToken}
              onChange={value => patch({ whipBearerToken: value })}
              onToggleReveal={() => setShowWhipToken(value => !value)}
            />
          </>
        )}
      </fieldset>

      <fieldset className="go-live-section" disabled={locked}>
        <legend>Quality</legend>
        <div className="go-live-grid">
          <label className="go-live-field">
            <span>Resolution</span>
            <select value={config.resolution} onChange={event => patch({ resolution: event.target.value as StreamResolutionPreset })}>
              <option value="720p">720p</option>
              <option value="1080p">1080p</option>
            </select>
          </label>
          <label className="go-live-field">
            <span>Frame rate</span>
            <select value={config.fps} onChange={event => patch({ fps: Number(event.target.value) as StreamFps })}>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="go-live-field">
            <span>Video bitrate (kbps)</span>
            <input type="number" min={500} max={50_000} step={100} value={config.videoBitrateKbps} onChange={event => patch({ videoBitrateKbps: Number(event.target.value) })} />
          </label>
          <label className="go-live-field">
            <span>Audio bitrate (kbps)</span>
            <input type="number" min={64} max={320} step={16} value={config.audioBitrateKbps} onChange={event => patch({ audioBitrateKbps: Number(event.target.value) })} />
          </label>
        </div>
      </fieldset>

      <fieldset className="go-live-section" disabled={locked}>
        <legend>Audio</legend>
        <div className="go-live-toggles">
          <label><input type="checkbox" checked={config.includeMasterAudio} onChange={event => patch({ includeMasterAudio: event.target.checked })} /> Include master audio</label>
          <label><input type="checkbox" checked={config.includeMicrophone} onChange={event => patch({ includeMicrophone: event.target.checked })} /> Microphone</label>
        </div>
        {config.includeMicrophone && (
          <label className="go-live-field">
            <span>Microphone device</span>
            <select value={config.microphoneDeviceId ?? ''} onChange={event => patch({ microphoneDeviceId: event.target.value || undefined })}>
              <option value="">System default</option>
              {microphones.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
          </label>
        )}
        <div className="go-live-meters" aria-label="Stream audio levels">
          {(['program', 'microphone'] as const).map(channel => (
            <div className="go-live-meter" key={channel}>
              <span>{channel === 'program' ? 'Program' : 'Microphone'}</span>
              <span className="go-live-meter-track"><span style={{ width: `${clampLevel(status.stats.audioLevels[channel]) * 100}%` }} /></span>
            </div>
          ))}
        </div>
      </fieldset>

      <section className="go-live-controls">
        <label className="go-live-record-toggle">
          <input type="checkbox" checked={config.recordLocally} disabled={locked} onChange={event => patch({ recordLocally: event.target.checked })} />
          Record locally and import into Media
        </label>

        {status.phase === 'live' && (
          <div className="go-live-stats" aria-label="Live stream status">
            <div><small>Uptime</small><strong>{uptime}</strong></div>
            <div><small>Dropped</small><strong>{status.stats.droppedFrames}</strong></div>
            <div><small>Encoder queue</small><strong>{status.stats.encodeQueueSize}</strong></div>
            <div><small>Bitrate</small><strong>{Math.round(status.stats.bitrateKbpsEstimate)} kbps</strong></div>
            {config.transport === 'rtmp' && <div><small>Relay queue</small><strong>{status.stats.queuedBytes} B</strong></div>}
            {status.activeRtmpRelay && <div><small>Relay</small><strong>relay: {status.activeRtmpRelay}</strong></div>}
            {status.recording && <span className="go-live-rec-badge">REC</span>}
          </div>
        )}

        <button
          className={`btn go-live-primary${status.phase === 'live' ? ' go-live-primary-end' : ''}`}
          type="button"
          disabled={actionDisabled}
          onClick={() => {
            if (status.phase === 'live') void endStream().catch(() => undefined);
            else {
              setDismissedError(null);
              void goLive().catch(() => undefined);
            }
          }}
        >
          {status.phase === 'starting' && <span className="go-live-spinner" aria-hidden="true" />}
          {status.phase === 'starting' ? 'Starting…' : status.phase === 'stopping' ? 'Ending…' : status.phase === 'live' ? 'End Stream' : 'Go Live'}
        </button>
      </section>
    </div>
  );
}
