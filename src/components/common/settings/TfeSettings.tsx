import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';

export function TfeSettings() {
  const tfeBackendUrl = useSettingsStore((s) => s.tfeBackendUrl);
  const tfeBackendConnected = useSettingsStore((s) => s.tfeBackendConnected);
  const setTfeBackendUrl = useSettingsStore((s) => s.setTfeBackendUrl);
  const setTfeBackendConnected = useSettingsStore((s) => s.setTfeBackendConnected);

  const [localUrl, setLocalUrl] = useState(tfeBackendUrl);
  const [checking, setChecking] = useState(false);
  const [capabilities, setCapabilities] = useState<{ name: string; category: string; description: string }[]>([]);

  const checkConnection = useCallback(async (url?: string) => {
    const targetUrl = url || localUrl;
    setChecking(true);
    try {
      const response = await fetch(`${targetUrl}/api/tfe/health`, { signal: AbortSignal.timeout(5000) });
      if (response.ok) {
        setTfeBackendConnected(true);
        // Also fetch capabilities
        const capRes = await fetch(`${targetUrl}/api/tfe/capabilities`);
        if (capRes.ok) {
          const data = await capRes.json();
          setCapabilities(data.tools || []);
        }
      } else {
        setTfeBackendConnected(false);
        setCapabilities([]);
      }
    } catch {
      setTfeBackendConnected(false);
      setCapabilities([]);
    }
    setChecking(false);
  }, [localUrl, setTfeBackendConnected]);

  useEffect(() => {
    checkConnection(tfeBackendUrl);
  }, []);

  const handleSaveUrl = () => {
    setTfeBackendUrl(localUrl);
    checkConnection(localUrl);
  };

  return (
    <div className="settings-category-content">
      <h2>TFE Pipeline</h2>

      <div className="settings-group">
        <div className="settings-group-title">Backend Connection</div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              backgroundColor: tfeBackendConnected ? '#4caf50' : '#f44336',
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {checking ? 'Checking...' : tfeBackendConnected ? 'Connected' : 'Not connected'}
          </span>
        </div>

        <div className="settings-row">
          <label className="settings-label">API URL</label>
          <div style={{ display: 'flex', gap: 8, flex: 1 }}>
            <input
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              className="settings-input"
              style={{ flex: 1 }}
              placeholder="http://127.0.0.1:8786"
            />
            <button
              onClick={handleSaveUrl}
              className="settings-btn"
              style={{
                padding: '4px 12px',
                fontSize: 12,
                backgroundColor: 'var(--accent)',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              Connect
            </button>
          </div>
        </div>

        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
          Start the TFE backend: <code style={{ background: 'var(--bg-tertiary)', padding: '2px 4px', borderRadius: 3 }}>python -m src.api_server</code>
        </p>
      </div>

      {capabilities.length > 0 && (
        <div className="settings-group">
          <div className="settings-group-title">Available Tools ({capabilities.length})</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {capabilities.map((tool) => (
              <div
                key={tool.name}
                style={{
                  padding: '6px 10px',
                  borderRadius: 6,
                  background: 'var(--bg-secondary)',
                  fontSize: 11,
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tool.name}</div>
                <div style={{ color: 'var(--text-tertiary)', marginTop: 2 }}>{tool.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
