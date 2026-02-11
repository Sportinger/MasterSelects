// Composition settings dialog

interface CompositionSettings {
  compositionId: string;
  width: number;
  height: number;
  frameRate: number;
  duration: number;
}

interface CompositionSettingsDialogProps {
  settings: CompositionSettings;
  onSettingsChange: (settings: CompositionSettings) => void;
  onSave: () => void;
  onCancel: () => void;
}

export function CompositionSettingsDialog({ settings, onSettingsChange, onSave, onCancel }: CompositionSettingsDialogProps) {
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
        <h3 style={{ margin: '0 0 16px 0', fontSize: '14px', fontWeight: 500, color: '#e0e0e0' }}>Composition Settings</h3>

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

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Frame Rate</label>
            <select
              value={settings.frameRate}
              onChange={(e) => onSettingsChange({
                ...settings,
                frameRate: Number(e.target.value),
              })}
              style={{ width: '100%', padding: '6px 8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff', fontSize: '13px' }}
            >
              <option value={23.976}>23.976 fps</option>
              <option value={24}>24 fps</option>
              <option value={25}>25 fps (PAL)</option>
              <option value={29.97}>29.97 fps (NTSC)</option>
              <option value={30}>30 fps</option>
              <option value={50}>50 fps</option>
              <option value={59.94}>59.94 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '4px', fontSize: '11px', color: '#888' }}>Duration (sec)</label>
            <input
              type="number"
              value={settings.duration}
              onChange={(e) => onSettingsChange({
                ...settings,
                duration: Math.max(1, parseFloat(e.target.value) || 60),
              })}
              min="1"
              max="86400"
              step="1"
              style={{ width: '100%', padding: '6px 8px', background: '#2a2a2a', border: '1px solid #3a3a3a', borderRadius: '4px', color: '#fff', fontSize: '13px' }}
            />
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
