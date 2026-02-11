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
    openai: false,
    assemblyai: false,
    deepgram: false,
    piapi: false,
    youtube: false,
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
        <div className="settings-group-title">Transcription</div>

        <ApiKeyRow
          label="OpenAI API Key"
          provider="openai"
          value={getKey('openai')}
          placeholder="sk-..."
          linkUrl="https://platform.openai.com/api-keys"
          linkText="Get API Key"
          show={showKeys.openai}
          onToggle={() => toggleShowKey('openai')}
          onChange={(v) => onKeyChange('openai', v)}
        />

        <ApiKeyRow
          label="AssemblyAI API Key"
          provider="assemblyai"
          value={getKey('assemblyai')}
          placeholder="Enter API key..."
          linkUrl="https://www.assemblyai.com/dashboard/signup"
          linkText="Get API Key"
          show={showKeys.assemblyai}
          onToggle={() => toggleShowKey('assemblyai')}
          onChange={(v) => onKeyChange('assemblyai', v)}
        />

        <ApiKeyRow
          label="Deepgram API Key"
          provider="deepgram"
          value={getKey('deepgram')}
          placeholder="Enter API key..."
          linkUrl="https://console.deepgram.com/signup"
          linkText="Get API Key"
          show={showKeys.deepgram}
          onToggle={() => toggleShowKey('deepgram')}
          onChange={(v) => onKeyChange('deepgram', v)}
        />
      </div>

      <div className="settings-group">
        <div className="settings-group-title">AI Video Generation</div>

        <ApiKeyRow
          label="PiAPI API Key"
          provider="piapi"
          value={getKey('piapi')}
          placeholder="Enter PiAPI key..."
          linkUrl="https://piapi.ai/workspace"
          linkText="Get API Key"
          show={showKeys.piapi}
          onToggle={() => toggleShowKey('piapi')}
          onChange={(v) => onKeyChange('piapi', v)}
        />
      </div>

      <div className="settings-group">
        <div className="settings-group-title">YouTube</div>

        <ApiKeyRow
          label="YouTube Data API v3 Key"
          provider="youtube"
          value={getKey('youtube')}
          placeholder="Enter YouTube API key..."
          linkUrl="https://console.cloud.google.com/apis/credentials"
          linkText="Get API Key"
          show={showKeys.youtube}
          onToggle={() => toggleShowKey('youtube')}
          onChange={(v) => onKeyChange('youtube', v)}
        />
      </div>
    </div>
  );
}
