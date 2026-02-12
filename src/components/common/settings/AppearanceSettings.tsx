import { useSettingsStore, type ThemeMode } from '../../../stores/settingsStore';

const themeOptions: { id: ThemeMode; label: string; bg: string; bar: string; accent: string }[] = [
  { id: 'dark',     label: 'Dark',     bg: '#1e1e1e', bar: '#0f0f0f', accent: '#2D8CEB' },
  { id: 'light',    label: 'Light',    bg: '#f5f5f5', bar: '#dedede', accent: '#1a73e8' },
  { id: 'midnight', label: 'Midnight', bg: '#000000', bar: '#111111', accent: '#3d9df5' },
  { id: 'system',   label: 'System',   bg: 'linear-gradient(135deg, #1e1e1e 50%, #f5f5f5 50%)', bar: '#333', accent: '#2D8CEB' },
  { id: 'crazy',    label: 'Crazy You', bg: 'linear-gradient(135deg, #e91e63 0%, #9c27b0 33%, #2196f3 66%, #4caf50 100%)', bar: 'linear-gradient(90deg, #ff9800, #e91e63)', accent: '#ffeb3b' },
  { id: 'custom',   label: 'Custom',   bg: 'linear-gradient(135deg, hsl(210,30%,12%) 0%, hsl(210,30%,22%) 100%)', bar: 'hsl(210,30%,8%)', accent: 'hsl(210,70%,55%)' },
];

/** Convert hue to a CSS color for the preview swatch */
function hueToPreviewBg(hue: number, brightness: number): string {
  const isLight = brightness > 50;
  const l = isLight ? 85 + (brightness - 50) * 0.3 : 4 + brightness * 0.28;
  return `linear-gradient(135deg, hsl(${hue},15%,${l}%) 0%, hsl(${hue},15%,${l + (isLight ? -8 : 8)}%) 100%)`;
}

export function AppearanceSettings() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const customHue = useSettingsStore((s) => s.customHue);
  const customBrightness = useSettingsStore((s) => s.customBrightness);
  const setCustomHue = useSettingsStore((s) => s.setCustomHue);
  const setCustomBrightness = useSettingsStore((s) => s.setCustomBrightness);

  return (
    <div className="settings-category-content">
      <h2>Appearance</h2>

      <div className="settings-group">
        <div className="settings-group-title">Theme</div>
        <div className="theme-selector">
          {themeOptions.map((opt) => {
            const isCustomCard = opt.id === 'custom';
            const bg = isCustomCard ? hueToPreviewBg(customHue, customBrightness) : opt.bg;
            const bar = isCustomCard ? `hsl(${customHue},15%,${customBrightness > 50 ? 78 : 8}%)` : opt.bar;
            const accent = isCustomCard ? `hsl(${customHue},70%,${customBrightness > 50 ? 45 : 55}%)` : opt.accent;

            return (
              <label key={opt.id} className={`theme-card ${theme === opt.id ? 'active' : ''}`}>
                <input
                  type="radio"
                  name="theme"
                  value={opt.id}
                  checked={theme === opt.id}
                  onChange={() => setTheme(opt.id)}
                />
                <div
                  className="theme-preview"
                  style={{ background: bg }}
                >
                  <div className="theme-preview-bar" style={{ background: bar }} />
                  <div className="theme-preview-accent" style={{ background: accent }} />
                </div>
                <span className="theme-card-label">{opt.label}</span>
              </label>
            );
          })}
        </div>
      </div>

      {theme === 'custom' && (
        <div className="settings-group">
          <div className="settings-group-title">Customize</div>

          <div className="custom-theme-controls">
            <div className="custom-theme-row">
              <label className="custom-theme-label">Color</label>
              <input
                type="range"
                min={0}
                max={360}
                value={customHue}
                onChange={(e) => setCustomHue(Number(e.target.value))}
                className="custom-theme-slider custom-theme-hue-slider"
              />
              <div
                className="custom-theme-swatch"
                style={{ background: `hsl(${customHue}, 70%, 55%)` }}
              />
            </div>

            <div className="custom-theme-row">
              <label className="custom-theme-label">Brightness</label>
              <input
                type="range"
                min={0}
                max={100}
                value={customBrightness}
                onChange={(e) => setCustomBrightness(Number(e.target.value))}
                className="custom-theme-slider"
              />
              <span className="custom-theme-value">{customBrightness}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
