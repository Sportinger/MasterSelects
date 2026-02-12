import { useSettingsStore, type PreviewQuality } from '../../../stores/settingsStore';

export function PreviewsSettings() {
  const { previewQuality, setPreviewQuality } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Previews</h2>

      <div className="settings-group">
        <div className="settings-group-title">Quality</div>

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
      </div>

      <div className="settings-group">
        <div className="settings-group-title">Transparency</div>
        <p className="settings-hint">Transparency grid is now per-tab. Toggle it using the checkerboard button in each preview panel.</p>
      </div>
    </div>
  );
}
