import { useSettingsStore, type GPUPowerPreference } from '../../../stores/settingsStore';

export function PerformanceSettings() {
  const {
    gpuPowerPreference,
    setGpuPowerPreference,
  } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Performance</h2>

      <div className="settings-group">
        <div className="settings-group-title">GPU</div>

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
    </div>
  );
}
