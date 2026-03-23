import { useCallback } from 'react';
import { useSettingsStore, type AutosaveInterval, type SaveMode, type PreviewQuality, type GPUPowerPreference } from '../../../stores/settingsStore';
// AutosaveInterval used in interval select onChange cast
import { useIsMobile } from '../../../hooks/useIsMobile';
import { useMIDI } from '../../../hooks/useMIDI';
import { OutputSettings } from './OutputSettings';
import { AIFeaturesSettings } from './AIFeaturesSettings';

export function GeneralSettings() {
  const {
    saveMode,
    autosaveInterval,
    copyMediaToProject,
    forceDesktopMode,
    previewQuality,
    gpuPowerPreference,
    setSaveMode,
    setAutosaveInterval,
    setCopyMediaToProject,
    setForceDesktopMode,
    setPreviewQuality,
    setGpuPowerPreference,
  } = useSettingsStore();

  const isMobileDevice = useIsMobile();
  const { isSupported, isEnabled, devices, lastMessage, enableMIDI, disableMIDI } = useMIDI();

  const handleSwitchToMobile = useCallback(() => {
    setForceDesktopMode(false);
    window.location.reload();
  }, [setForceDesktopMode]);

  return (
    <div className="settings-category-content">
      <h2>General</h2>

      {/* Import */}
      <div className="settings-group">
        <div className="settings-group-title">Import</div>

        <label className="settings-row">
          <span className="settings-label">Copy media to project folder</span>
          <input
            type="checkbox"
            checked={copyMediaToProject}
            onChange={(e) => setCopyMediaToProject(e.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          When importing clips, copy them to the project's Raw folder for easier relinking.
        </p>
      </div>

      {/* Save Mode */}
      <div className="settings-group">
        <div className="settings-group-title">Save</div>

        <label className="settings-row">
          <span className="settings-label">Save Mode</span>
          <select
            value={saveMode}
            onChange={(e) => setSaveMode(e.target.value as SaveMode)}
            className="settings-select"
          >
            <option value="continuous">Continuous (every change)</option>
            <option value="interval">Interval (timed)</option>
          </select>
        </label>
        <p className="settings-hint">
          {saveMode === 'continuous'
            ? 'Project is saved automatically after every change. You never have to think about saving.'
            : 'Project is saved on a timer interval. You can also save manually with Ctrl+S.'}
        </p>

        {saveMode === 'interval' && (
          <>
            <label className="settings-row">
              <span className="settings-label">Save Interval</span>
              <select
                value={autosaveInterval}
                onChange={(e) => setAutosaveInterval(Number(e.target.value) as AutosaveInterval)}
                className="settings-select"
              >
                <option value={1}>1 minute</option>
                <option value={2}>2 minutes</option>
                <option value={5}>5 minutes</option>
                <option value={10}>10 minutes</option>
              </select>
            </label>
          </>
        )}
      </div>

      {isMobileDevice && forceDesktopMode && (
        <div className="settings-group">
          <div className="settings-group-title">View Mode</div>
          <p className="settings-description">
            You're viewing the desktop interface on a mobile device.
          </p>
          <button className="settings-button" onClick={handleSwitchToMobile}>
            Switch to Mobile View
          </button>
        </div>
      )}

      {/* Output */}
      <OutputSettings embedded />

      {/* Preview */}
      <div className="settings-group">
        <div className="settings-group-title">Preview</div>

        <label className="settings-row">
          <span className="settings-label">Preview Resolution</span>
          <select
            value={previewQuality}
            onChange={(e) => setPreviewQuality(Number(e.target.value) as PreviewQuality)}
            className="settings-select"
          >
            <option value={1}>Full (100%)</option>
            <option value={0.5}>Half (50%)</option>
            <option value={0.25}>Quarter (25%)</option>
          </select>
        </label>
        <p className="settings-hint">Lower resolution improves playback performance.</p>

        <p className="settings-hint">
          Transparency grid is per-tab. Toggle it using the checkerboard button in each preview panel.
        </p>
      </div>

      {/* Performance */}
      <div className="settings-group">
        <div className="settings-group-title">Performance</div>

        <label className="settings-row">
          <span className="settings-label">GPU Power Preference</span>
          <select
            value={gpuPowerPreference}
            onChange={(e) => setGpuPowerPreference(e.target.value as GPUPowerPreference)}
            className="settings-select"
          >
            <option value="high-performance">High Performance (Discrete GPU)</option>
            <option value="low-power">Low Power (Integrated GPU)</option>
          </select>
        </label>
        <p className="settings-hint">
          Requires page reload to take effect.
        </p>
      </div>

      {/* MIDI */}
      <div className="settings-group">
        <div className="settings-group-title">MIDI Control</div>

        {isSupported ? (
          <>
            <label className="settings-row">
              <span className="settings-label">Enable MIDI</span>
              <input
                type="checkbox"
                checked={isEnabled}
                onChange={(e) => { if (e.target.checked) enableMIDI(); else disableMIDI(); }}
                className="settings-checkbox"
              />
            </label>

            {isEnabled && (
              <>
                <div className="settings-status">
                  <span className={`status-indicator ${devices.length > 0 ? 'connected' : 'disconnected'}`} />
                  <span className="status-text">
                    {devices.length > 0
                      ? `${devices.length} device${devices.length > 1 ? 's' : ''} connected`
                      : 'No devices detected'}
                  </span>
                </div>

                {devices.length > 0 && (
                  <div className="settings-group" style={{ marginTop: 8 }}>
                    <div className="settings-group-title">Devices</div>
                    {devices.map((device) => (
                      <div key={device.id} className="settings-row">
                        <span className="settings-label">{device.name}</span>
                        <span className="settings-hint" style={{ margin: 0 }}>
                          {device.manufacturer !== 'Unknown' ? device.manufacturer : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {lastMessage && (
                  <div className="settings-group" style={{ marginTop: 8 }}>
                    <div className="settings-group-title">Last Message</div>
                    <div className="settings-row">
                      <span className="settings-label">
                        CH {lastMessage.channel} / CC {lastMessage.control} / Val {lastMessage.value}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        ) : (
          <p className="settings-hint">
            MIDI is not supported in this browser. Use Chrome or Edge for Web MIDI API support.
          </p>
        )}
      </div>

      {/* AI Features */}
      <AIFeaturesSettings embedded />
    </div>
  );
}
