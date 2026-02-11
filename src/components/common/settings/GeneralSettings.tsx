import { useCallback } from 'react';
import { useSettingsStore, type AutosaveInterval } from '../../../stores/settingsStore';
import { useIsMobile } from '../../../hooks/useIsMobile';

export function GeneralSettings() {
  const {
    autosaveEnabled,
    autosaveInterval,
    forceDesktopMode,
    setAutosaveEnabled,
    setAutosaveInterval,
    setForceDesktopMode,
  } = useSettingsStore();

  const isMobileDevice = useIsMobile();

  const handleSwitchToMobile = useCallback(() => {
    setForceDesktopMode(false);
    window.location.reload();
  }, [setForceDesktopMode]);

  return (
    <div className="settings-category-content">
      <h2>General</h2>

      <div className="settings-group">
        <div className="settings-group-title">Autosave</div>

        <label className="settings-row">
          <span className="settings-label">Enable Autosave</span>
          <input
            type="checkbox"
            checked={autosaveEnabled}
            onChange={(e) => setAutosaveEnabled(e.target.checked)}
            className="settings-checkbox"
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">Autosave Interval</span>
          <select
            value={autosaveInterval}
            onChange={(e) => setAutosaveInterval(Number(e.target.value) as AutosaveInterval)}
            disabled={!autosaveEnabled}
            className="settings-select"
          >
            <option value={1}>1 minute</option>
            <option value={2}>2 minutes</option>
            <option value={5}>5 minutes</option>
            <option value={10}>10 minutes</option>
          </select>
        </label>
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
    </div>
  );
}
