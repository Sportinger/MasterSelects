import { useState } from 'react';
import { useSettingsStore } from '../../../stores/settingsStore';

interface ApiKeyRowProps {
  label: string;
  provider: string;
  value: string;
  placeholder: string;
  linkUrl: string;
  linkText: string;
  show: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}

function ApiKeyRow({ label, value, placeholder, linkUrl, linkText, show, onToggle, onChange }: ApiKeyRowProps) {
  return (
    <div className="api-key-row">
      <label>{label}</label>
      <div className="api-key-input">
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
        />
        <button className="toggle-visibility" onClick={onToggle}>
          {show ? '\uD83D\uDC41' : '\u25CB'}
        </button>
      </div>
      <a className="api-key-link" href={linkUrl} target="_blank" rel="noopener noreferrer">
        {linkText}
      </a>
    </div>
  );
}

interface ApiKeysSettingsProps {
  localKeys: { [key: string]: string };
  onKeyChange: (provider: string, value: string) => void;
}

export function ApiKeysSettings({ localKeys, onKeyChange }: ApiKeysSettingsProps) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const [showKeys, setShowKeys] = useState({
    anthropic: false,
  });

  const toggleShowKey = (provider: keyof typeof showKeys) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  // Use localKeys if provided, otherwise fall back to store
  const getKey = (provider: string) => localKeys[provider] ?? (apiKeys as unknown as Record<string, string>)[provider] ?? '';

  return (
    <div className="settings-category-content">
      <h2>API Keys</h2>
      <p className="settings-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Keys are stored locally and encrypted in your browser.
      </p>

      <div className="settings-group">
        <div className="settings-group-title">AI Assistant</div>

        <ApiKeyRow
          label="Anthropic API Key"
          provider="anthropic"
          value={getKey('anthropic')}
          placeholder="sk-ant-..."
          linkUrl="https://console.anthropic.com/settings/keys"
          linkText="Get API Key"
          show={showKeys.anthropic}
          onToggle={() => toggleShowKey('anthropic')}
          onChange={(v) => onKeyChange('anthropic', v)}
        />
      </div>
    </div>
  );
}
