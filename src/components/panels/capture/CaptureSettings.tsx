import { useEffect, useState } from 'react';
import type { CaptureSessionSnapshot } from '../../../services/capture/recording/sessionTypes';
import { useUiSettingsStore } from '../../../stores/uiSettingsStore';
import { flags } from '../../../engine/featureFlags';

// eslint-disable-next-line react-refresh/only-export-components
export const CAPTURE_BITRATES = {
  balanced: 6_000_000,
  quality: 12_000_000,
  high: 20_000_000,
} as const;

export function CaptureSettings({ snapshot }: { snapshot: CaptureSessionSnapshot }) {
  const settings = useUiSettingsStore();
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const locked = snapshot.phase === 'recording' || snapshot.phase === 'paused' || snapshot.phase === 'stopping';
  const sourceLocked = snapshot.phase === 'previewing' || locked;
  const webCodecsAvailable = flags.screenCaptureWebCodecs
    && typeof globalThis.VideoEncoder !== 'undefined'
    && 'MediaStreamTrackProcessor' in globalThis;
  useEffect(() => {
    if (!settings.captureMicrophoneEnabled || !navigator.mediaDevices?.enumerateDevices) return;
    const refresh = () => void navigator.mediaDevices.enumerateDevices().then(devices => {
      setMicrophones(devices.filter(device => device.kind === 'audioinput'));
    }).catch(() => setMicrophones([]));
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => navigator.mediaDevices.removeEventListener('devicechange', refresh);
  }, [settings.captureMicrophoneEnabled]);

  return (
    <fieldset className="capture-settings" disabled={locked}>
      <legend>Recording settings</legend>
      <div className="capture-select-grid">
        <label className="capture-select-field">
          <span>Frame rate</span>
          <select value={settings.captureFps} onChange={event => settings.setCaptureFps(Number(event.target.value) as 30 | 60)}>
            <option value={30}>30 fps</option>
            <option value={60}>60 fps</option>
          </select>
        </label>
        <label className="capture-select-field">
          <span>Quality</span>
          <select value={settings.captureBitratePreset} onChange={event => settings.setCaptureBitratePreset(event.target.value as keyof typeof CAPTURE_BITRATES)}>
            <option value="balanced">Balanced · 6 Mbps</option>
            <option value="quality">Quality · 12 Mbps</option>
            <option value="high">High · 20 Mbps</option>
          </select>
        </label>
        <label className="capture-select-field">
          <span>Output scale</span>
          <select value={settings.captureScalePreset} onChange={event => settings.setCaptureScalePreset(event.target.value as typeof settings.captureScalePreset)} disabled={!webCodecsAvailable || locked}>
            <option value="100">100%</option>
            <option value="75">75%</option>
            <option value="50">50%</option>
            <option value="1080p">1080p target</option>
          </select>
        </label>
        {settings.captureMicrophoneEnabled && (
          <label className="capture-select-field">
            <span>Microphone device</span>
            <select value={settings.audioInputDeviceId} disabled={sourceLocked} onChange={event => settings.setAudioInputDeviceId(event.target.value)}>
              <option value="">System default</option>
              {microphones.map(device => <option key={device.deviceId} value={device.deviceId}>{device.label || 'Microphone'}</option>)}
            </select>
          </label>
        )}
      </div>
      {!webCodecsAvailable && <p className="capture-settings-hint">Crop and scale require the enabled WebCodecs capture tier.</p>}
      <div className="capture-toggle-grid">
        <label className="capture-toggle">
          <input type="checkbox" checked={settings.captureCursorEnabled} disabled={sourceLocked || snapshot.cursorSupported === false} onChange={event => settings.setCaptureCursorEnabled(event.target.checked)} />
          <span><strong>Include cursor</strong><small>Show pointer movement</small></span>
        </label>
        <label className="capture-toggle">
          <input type="checkbox" checked={settings.captureMicrophoneEnabled} disabled={sourceLocked} onChange={event => settings.setCaptureMicrophoneEnabled(event.target.checked)} />
          <span><strong>Microphone</strong><small>Mix voice into recording</small></span>
        </label>
        {snapshot.hasDisplayAudio !== false && (
          <label className="capture-toggle">
            <input type="checkbox" checked={settings.captureDisplayAudioEnabled} disabled={sourceLocked} onChange={event => settings.setCaptureDisplayAudioEnabled(event.target.checked)} />
            <span><strong>Source audio</strong><small>Capture tab or system sound</small></span>
          </label>
        )}
        {snapshot.selectedSurface === 'browser' && snapshot.hasDisplayAudio && (
          <label className="capture-toggle">
            <input type="checkbox" checked={settings.captureMuteCapturedTab} disabled={sourceLocked} onChange={event => settings.setCaptureMuteCapturedTab(event.target.checked)} />
            <span><strong>Mute tab locally</strong><small>Does not enable echo cancellation</small></span>
          </label>
        )}
        <label className="capture-toggle">
          <input type="checkbox" checked={settings.captureAutoPlaceOnTimeline} onChange={event => settings.setCaptureAutoPlaceOnTimeline(event.target.checked)} />
          <span><strong>Place on timeline</strong><small>Add above the current edit</small></span>
        </label>
      </div>
      {snapshot.phase === 'previewing' && snapshot.hasDisplayAudio === false && <p className="capture-settings-hint">This source supplied no tab/system audio. The microphone is still available.</p>}
      {sourceLocked && <p className="capture-settings-hint">Source and audio-input changes apply to the next source selection.</p>}
    </fieldset>
  );
}
