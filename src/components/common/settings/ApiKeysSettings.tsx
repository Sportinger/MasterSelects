import { useState } from 'react';
import {
  useSettingsStore,
  type APIKeys,
  type ApiKeyDefaultProvider,
} from '../../../stores/settingsStore';

const DEFAULTABLE_PROVIDERS = new Set<string>([
  'openai',
  'anthropic',
  'piapi',
  'kieai',
  'evolink',
  'elevenlabs',
]);

interface ApiKeyRowProps {
  label: string;
  provider: keyof APIKeys;
  value: string;
  placeholder: string;
  linkUrl: string;
  linkText: string;
  show: boolean;
  defaultEnabled?: boolean;
  supportsDefault?: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
  onDefaultChange?: (enabled: boolean) => void;
}

function isDefaultableProvider(provider: keyof APIKeys): provider is ApiKeyDefaultProvider {
  return DEFAULTABLE_PROVIDERS.has(provider);
}

function ApiKeyRow({
  defaultEnabled = false,
  label,
  linkText,
  linkUrl,
  onChange,
  onDefaultChange,
  onToggle,
  placeholder,
  show,
  supportsDefault = false,
  value,
}: ApiKeyRowProps) {
  const hasKey = value.trim().length > 0;

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
      {supportsDefault && onDefaultChange && (
        <label className={`api-key-default ${!hasKey ? 'disabled' : ''}`}>
          <input
            type="checkbox"
            checked={defaultEnabled}
            disabled={!hasKey}
            onChange={(e) => onDefaultChange(e.target.checked)}
          />
          <span>Use as default instead of Cloud credits</span>
        </label>
      )}
    </div>
  );
}

interface ApiKeysSettingsProps {
  localKeys: { [key: string]: string };
  onKeyChange: (provider: string, value: string) => void;
}

export function ApiKeysSettings({ localKeys, onKeyChange }: ApiKeysSettingsProps) {
  const apiKeys = useSettingsStore((s) => s.apiKeys);
  const apiKeyDefaults = useSettingsStore((s) => s.apiKeyDefaults);
  const setApiKeyDefault = useSettingsStore((s) => s.setApiKeyDefault);
  const [showKeys, setShowKeys] = useState({
    openai: false,
    anthropic: false,
    assemblyai: false,
    deepgram: false,
    piapi: false,
    kieai: false,
    evolink: false,
    elevenlabs: false,
    youtube: false,
  });

  const toggleShowKey = (provider: keyof typeof showKeys) => {
    setShowKeys((prev) => ({ ...prev, [provider]: !prev[provider] }));
  };

  // Use localKeys if provided, otherwise fall back to store
  const getKey = (provider: string) => localKeys[provider] ?? (apiKeys as unknown as Record<string, string>)[provider] ?? '';

  const renderApiKeyRow = (props: Omit<ApiKeyRowProps, 'defaultEnabled' | 'onDefaultChange' | 'supportsDefault'>) => {
    if (isDefaultableProvider(props.provider)) {
      const provider = props.provider;

      return (
        <ApiKeyRow
          {...props}
          defaultEnabled={apiKeyDefaults[provider] ?? false}
          supportsDefault
          onDefaultChange={(enabled) => setApiKeyDefault(provider, enabled)}
        />
      );
    }

    return (
      <ApiKeyRow
        {...props}
        defaultEnabled={false}
        supportsDefault={false}
      />
    );
  };

  return (
    <div className="settings-category-content">
      <h2>API Keys</h2>
      <p className="settings-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        Keys are stored locally and encrypted in your browser. Cloud credits stay the default unless a key below is marked as default.
      </p>

      <div className="settings-group">
        <div className="settings-group-title">Transcription</div>

        {renderApiKeyRow({
          label: 'OpenAI API Key',
          provider: 'openai',
          value: getKey('openai'),
          placeholder: 'sk-...',
          linkUrl: 'https://platform.openai.com/api-keys',
          linkText: 'Get API Key',
          show: showKeys.openai,
          onToggle: () => toggleShowKey('openai'),
          onChange: (v) => onKeyChange('openai', v),
        })}

        {renderApiKeyRow({
          label: 'AssemblyAI API Key',
          provider: 'assemblyai',
          value: getKey('assemblyai'),
          placeholder: 'Enter API key...',
          linkUrl: 'https://www.assemblyai.com/dashboard/signup',
          linkText: 'Get API Key',
          show: showKeys.assemblyai,
          onToggle: () => toggleShowKey('assemblyai'),
          onChange: (v) => onKeyChange('assemblyai', v),
        })}

        {renderApiKeyRow({
          label: 'Deepgram API Key',
          provider: 'deepgram',
          value: getKey('deepgram'),
          placeholder: 'Enter API key...',
          linkUrl: 'https://console.deepgram.com/signup',
          linkText: 'Get API Key',
          show: showKeys.deepgram,
          onToggle: () => toggleShowKey('deepgram'),
          onChange: (v) => onKeyChange('deepgram', v),
        })}
      </div>

      <div className="settings-group">
        <div className="settings-group-title">AI Media Generation</div>

        {renderApiKeyRow({
          label: 'PiAPI API Key',
          provider: 'piapi',
          value: getKey('piapi'),
          placeholder: 'Enter PiAPI key...',
          linkUrl: 'https://piapi.ai/workspace',
          linkText: 'Get API Key',
          show: showKeys.piapi,
          onToggle: () => toggleShowKey('piapi'),
          onChange: (v) => onKeyChange('piapi', v),
        })}

        {renderApiKeyRow({
          label: 'Kie.ai API Key',
          provider: 'kieai',
          value: getKey('kieai'),
          placeholder: 'Enter Kie.ai key...',
          linkUrl: 'https://kie.ai',
          linkText: 'Get API Key',
          show: showKeys.kieai,
          onToggle: () => toggleShowKey('kieai'),
          onChange: (v) => onKeyChange('kieai', v),
        })}

        {renderApiKeyRow({
          label: 'EvoLink API Key',
          provider: 'evolink',
          value: getKey('evolink'),
          placeholder: 'Enter EvoLink API key...',
          linkUrl: 'https://evolink.ai',
          linkText: 'Get API Key',
          show: showKeys.evolink,
          onToggle: () => toggleShowKey('evolink'),
          onChange: (v) => onKeyChange('evolink', v),
        })}
      </div>
      <div className="settings-group">
        <div className="settings-group-title">AI Chat</div>

        {renderApiKeyRow({
          label: 'Anthropic API Key',
          provider: 'anthropic',
          value: getKey('anthropic'),
          placeholder: 'sk-ant-...',
          linkUrl: 'https://console.anthropic.com/settings/keys',
          linkText: 'Get API Key',
          show: showKeys.anthropic,
          onToggle: () => toggleShowKey('anthropic'),
          onChange: (v) => onKeyChange('anthropic', v),
        })}
      </div>
      <div className="settings-group">
        <div className="settings-group-title">AI Audio Generation</div>

        {renderApiKeyRow({
          label: 'ElevenLabs API Key',
          provider: 'elevenlabs',
          value: getKey('elevenlabs'),
          placeholder: 'Enter ElevenLabs API key...',
          linkUrl: 'https://elevenlabs.io/app/settings/api-keys',
          linkText: 'Get API Key',
          show: showKeys.elevenlabs,
          onToggle: () => toggleShowKey('elevenlabs'),
          onChange: (v) => onKeyChange('elevenlabs', v),
        })}
      </div>
      <div className="settings-group">
        <div className="settings-group-title">YouTube</div>

        {renderApiKeyRow({
          label: 'YouTube Data API v3 Key',
          provider: 'youtube',
          value: getKey('youtube'),
          placeholder: 'Enter YouTube API key...',
          linkUrl: 'https://console.cloud.google.com/apis/credentials',
          linkText: 'Get API Key',
          show: showKeys.youtube,
          onToggle: () => toggleShowKey('youtube'),
          onChange: (v) => onKeyChange('youtube', v),
        })}
      </div>
    </div>
  );
}
