import { useSettingsStore } from '../../../stores/settingsStore';

export function ImportSettings() {
  const { copyMediaToProject, setCopyMediaToProject } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Import</h2>

      <div className="settings-group">
        <div className="settings-group-title">Media Import</div>

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
    </div>
  );
}
