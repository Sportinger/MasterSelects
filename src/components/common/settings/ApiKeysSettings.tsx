import { useState, useCallback } from 'react';
import { useSettingsStore, type APIKeys } from '../../../stores/settingsStore';
import { lemonadeProvider } from '../../../services/lemonadeProvider';

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

export function ApiKeysSettings() {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const setApiKey = useSettingsStore((s) => s.setApiKey);
  const lemonadeEndpoint = useSettingsStore((s) => s.lemonadeEndpoint);
  const setLemonadeEndpoint = useSettingsStore((s) => s.setLemonadeEndpoint);
  const [showKeys, setShowKeys] = useState({
    openai: false,
    assemblyai: false,
    deepgram: false,
    piapi: false,
    kieai: false,
    youtube: false,
  });

  const toggleShowKey = useCallback((provider: keyof typeof showKeys) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  }, []);

  // Use store directly - no props needed
  const getKey = useCallback((provider: string) => {
    return (apiKeys as unknown as Record<string, string>)[provider] ?? '';
  }, [apiKeys]);

  const handleKeyChange = useCallback((provider: keyof APIKeys, value: string) => {
    setApiKey(provider, value);
  }, [setApiKey]);

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
          onChange={(v) => handleKeyChange('openai', v)}
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
          onChange={(v) => handleKeyChange('assemblyai', v)}
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
          onChange={(v) => handleKeyChange('deepgram', v)}
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
          onChange={(v) => handleKeyChange('piapi', v)}
        />

        <ApiKeyRow
          label="Kie.ai API Key"
          provider="kieai"
          value={getKey('kieai')}
          placeholder="Enter Kie.ai key..."
          linkUrl="https://kie.ai"
          linkText="Get API Key"
          show={showKeys.kieai}
          onToggle={() => toggleShowKey('kieai')}
          onChange={(v) => handleKeyChange('kieai', v)}
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
          onChange={(v) => handleKeyChange('youtube', v)}
        />
      </div>

      <div className="settings-group" style={{ marginTop: '24px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
        <div className="settings-group-title">Lemonade Server (Local AI)</div>

        <div className="settings-row">
          <span className="settings-label">Server Endpoint</span>
          <input
            type="text"
            value={lemonadeEndpoint}
            onChange={(e) => {
              setLemonadeEndpoint(e.target.value);
              lemonadeProvider.configure({ endpoint: e.target.value });
            }}
            placeholder="http://localhost:8000/api/v1"
            className="settings-input"
            style={{ width: '280px' }}
          />
        </div>

        <p className="settings-hint">
          Lemonade Server provides local AI inference - no API key required.
          Configure the server endpoint URL above.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
          <a
            className="api-key-link"
            href="https://github.com/lemonade-server/lemonade"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download Lemonade Server
          </a>
          <a
            className="api-key-link"
            href="https://github.com/lemonade-server/lemonade?tab=readme-ov-file#quick-start"
            target="_blank"
            rel="noopener noreferrer"
          >
            Quick Start Guide
          </a>
        </div>

        <p className="settings-hint" style={{ marginTop: '8px' }}>
          Once installed, start Lemonade Server and configure AI Chat to use the Lemonade provider.
          Server status and model selection are available in Settings {'>'} AI Features.
        </p>
      </div>
    </div>
  );
}
