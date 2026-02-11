import { useSettingsStore } from '../../../stores/settingsStore';

export function OutputSettings() {
  const { outputResolution, fps, setResolution } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Output</h2>

      <div className="settings-group">
        <div className="settings-group-title">Default Resolution (New Compositions)</div>
        <p className="settings-hint">
          Applies only to newly created compositions. Active composition resolution is set per composition in the Media Panel.
        </p>

        <label className="settings-row">
          <span className="settings-label">Width</span>
          <input
            type="number"
            value={outputResolution.width}
            onChange={(e) => setResolution(Number(e.target.value), outputResolution.height)}
            className="settings-input settings-input-number"
            min={1}
            max={7680}
          />
        </label>

        <label className="settings-row">
          <span className="settings-label">Height</span>
          <input
            type="number"
            value={outputResolution.height}
            onChange={(e) => setResolution(outputResolution.width, Number(e.target.value))}
            className="settings-input settings-input-number"
            min={1}
            max={4320}
          />
        </label>

        <div className="preset-buttons">
          <button className="preset-btn" onClick={() => setResolution(1920, 1080)}>1080p</button>
          <button className="preset-btn" onClick={() => setResolution(2560, 1440)}>1440p</button>
          <button className="preset-btn" onClick={() => setResolution(3840, 2160)}>4K</button>
          <button className="preset-btn" onClick={() => setResolution(1080, 1920)}>9:16</button>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Frame Rate</div>
        <p className="settings-hint">
          Current: {fps} FPS (configured per composition)
        </p>
      </div>
    </div>
  );
}
