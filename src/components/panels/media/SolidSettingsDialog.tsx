// Solid settings dialog

interface SolidSettings {
  solidItemId: string;
  width: number;
  height: number;
  color: string;
}

interface SolidSettingsDialogProps {
  settings: SolidSettings;
  onSettingsChange: (settings: SolidSettings) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function SolidSettingsDialog({ settings, onSettingsChange, onSave, onCancel }: SolidSettingsDialogProps) {
  return (
    <div
      className="comp-settings-overlay"
      onClick={onCancel}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 10001,
      }}
    >
      <div
        className="comp-settings-dialog"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: '#1e1e1e',
          border: '1px solid #3a3a3a',
          borderRadius: '6px',
          padding: '20px',
          minWidth: '340px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 500, color: '#e0e0e0' }}>Solid Settings</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Width</label>
            <input
              type="number"
              value={settings.width}
              onChange={(e) => onSettingsChange({
                ...settings,
                width: Math.max(1, parseInt(e.target.value) || 1920),
              })}
              min="1"
              max="7680"
              style={{ width: '100%', padding: '6px 8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff', fontSize: '13px' }}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Height</label>
            <input
              type="number"
              value={settings.height}
              onChange={(e) => onSettingsChange({
                ...settings,
                height: Math.max(1, parseInt(e.target.value) || 1080),
              })}
              min="1"
              max="4320"
              style={{ width: '100%', padding: '6px 8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff', fontSize: '13px' }}
            />
          </div>

          <div style={{ gridColumn: '1 / -1' }}>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Color</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="color"
                value={settings.color}
                onChange={(e) => onSettingsChange({ ...settings, color: e.target.value })}
                style={{ width: '36px', height: '28px', padding: '0', border: '1px solid #3a3a3a', borderRadius: '4px', cursor: 'pointer', background: 'transparent' }}
              />
              <span style={{ fontSize: '12px', color: '#ccc', fontFamily: 'monospace' }}>
                {settings.color}
              </span>
            </div>
          </div>
        </div>

        {/* Resolution Presets */}
        <div style={{ marginTop: '12px' }}>
          <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Presets</label>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {[
              { label: '1080p', w: 1920, h: 1080 },
              { label: '4K', w: 3840, h: 2160 },
              { label: '720p', w: 1280, h: 720 },
              { label: '9:16', w: 1080, h: 1920 },
              { label: '1:1', w: 1080, h: 1080 },
            ].map((preset) => (
              <button
                key={preset.label}
                onClick={() => onSettingsChange({ ...settings, width: preset.w, height: preset.h })}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  background: settings.width === preset.w && settings.height === preset.h ? '#4a90e2' : '#2a2a2a',
                  border: '1px solid #3a3a3a',
                  borderRadius: '3px',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ padding: '6px 16px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' }}
          >
            Cancel
          </button>
          <button
            onClick={onSave}
            style={{ padding: '6px 16px', background: '#4a90e2', border: 'none', borderRadius: '4px', color: '#fff', cursor: 'pointer', fontSize: '12px' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
