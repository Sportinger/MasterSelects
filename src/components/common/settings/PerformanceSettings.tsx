import { useSettingsStore, type GPUPowerPreference } from '../../../stores/settingsStore';
import { ScrubCacheSettings } from './ScrubCacheSettings';

export function PerformanceSettings() {
  const {
    gpuPowerPreference,
    setGpuPowerPreference,
    flockTimelineThumbnails,
    setFlockTimelineThumbnails,
  } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Performance</h2>
      <ScrubCacheSettings />

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

      <div className="settings-group">
        <div className="settings-group-title">Timeline</div>

        <label className="settings-row">
          <span className="settings-label">Simulated Flock thumbnails</span>
          <input
            type="checkbox"
            checked={flockTimelineThumbnails}
            onChange={(event) => setFlockTimelineThumbnails(event.target.checked)}
            className="settings-checkbox"
          />
        </label>
        <p className="settings-hint">
          Off by default: the filmstrip re-simulates the swarm on the CPU in the editor thread, which stalls heavy
          scenes such as fluid sculptures. Clips show their icon instead.
        </p>
      </div>
    </div>
  );
}
