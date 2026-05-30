import { useCallback, type ChangeEvent } from 'react';
import {
  MAX_SHORTCUT_DISPLAY_SCALE,
  MIN_SHORTCUT_DISPLAY_SCALE,
  useSettingsStore,
  type AutosaveInterval,
  type SaveMode,
  type PreviewQuality,
  type GPUPowerPreference,
  type TimelineZoomAnchor,
} from '../../../stores/settingsStore';
// AutosaveInterval used in interval select onChange cast
import { useIsMobile } from '../../../hooks/useIsMobile';
import { requestShortcutDisplayPreview } from '../shortcutDisplayPreview';
import { OutputSettings } from './OutputSettings';
import { AIFeaturesSettings } from './AIFeaturesSettings';

export function GeneralSettings() {
  const {
    saveMode,
    autosaveInterval,
    copyMediaToProject,
    forceDesktopMode,
    timelineZoomAnchor,
    showShortcutDisplay,
    shortcutDisplayScale,
    previewQuality,
    gpuPowerPreference,
    setSaveMode,
    setAutosaveInterval,
    setCopyMediaToProject,
    setForceDesktopMode,
    setTimelineZoomAnchor,
    setShowShortcutDisplay,
    setShortcutDisplayScale,
    setPreviewQuality,
    setGpuPowerPreference,
  } = useSettingsStore();

  const isMobileDevice = useIsMobile();

  const handleSwitchToMobile = useCallback(() => {
    setForceDesktopMode(false);
    window.location.reload();
  }, [setForceDesktopMode]);

  const handleShortcutDisplayToggle = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setShowShortcutDisplay(event.target.checked);
    requestShortcutDisplayPreview();
  }, [setShowShortcutDisplay]);

  const handleShortcutDisplayScaleChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setShortcutDisplayScale(Number(event.target.value));
    requestShortcutDisplayPreview();
  }, [setShortcutDisplayScale]);

  const shortcutDisplayScalePercent = Math.round(shortcutDisplayScale * 100);

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

      {/* Timeline */}
      <div className="settings-group">
        <div className="settings-group-title">Timeline</div>

        <label className="settings-row">
          <span className="settings-label">Zoom Anchor</span>
          <select
            value={timelineZoomAnchor}
            onChange={(e) => setTimelineZoomAnchor(e.target.value as TimelineZoomAnchor)}
            className="settings-select"
          >
            <option value="mouse">Mouse Pointer</option>
            <option value="playhead">Playhead</option>
          </select>
        </label>
        <p className="settings-hint">
          Controls whether Ctrl/Alt+scroll zooms toward the cursor or the playhead.
        </p>
      </div>

      {/* Input Display */}
      <div className="settings-group">
        <div className="settings-group-title">Input Display</div>

        <label className="settings-row">
          <span className="settings-label">Show shortcuts and mouse clicks</span>
          <input
            type="checkbox"
            checked={showShortcutDisplay}
            onChange={handleShortcutDisplayToggle}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          Recent key presses, clicks, drags, and wheel gestures appear near the bottom-left of the app.
        </p>

        <label className="settings-row shortcut-display-size-row">
          <span className="settings-label">Size</span>
          <span className="shortcut-display-size-control">
            <input
              type="range"
              min={MIN_SHORTCUT_DISPLAY_SCALE}
              max={MAX_SHORTCUT_DISPLAY_SCALE}
              step={0.05}
              value={shortcutDisplayScale}
              onChange={handleShortcutDisplayScaleChange}
              onFocus={() => requestShortcutDisplayPreview()}
              onPointerDown={() => requestShortcutDisplayPreview(5000)}
              onPointerUp={() => requestShortcutDisplayPreview()}
              className="settings-range"
            />
            <span className="shortcut-display-size-value">{shortcutDisplayScalePercent}%</span>
          </span>
        </label>
      </div>

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

      {/* AI Features */}
      <AIFeaturesSettings embedded />
    </div>
  );
}
