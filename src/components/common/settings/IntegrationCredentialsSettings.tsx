import { useState } from 'react';

interface IntegrationCredentialsSettingsProps {
  onYouTubeApiKeyChange: (value: string) => void;
  youtubeApiKey: string;
}
export function IntegrationCredentialsSettings({
  onYouTubeApiKeyChange,
  youtubeApiKey,
}: IntegrationCredentialsSettingsProps) {
  const [showKey, setShowKey] = useState(false);

  return (
    <div className="settings-category-content">
      <h2>Integrations</h2>
      <p className="settings-hint" style={{ marginTop: 0, marginBottom: 8 }}>
        MasterSelects AI uses authenticated hosted services. The optional YouTube Data API key is a
        non-AI integration credential and stays encrypted in this browser.
      </p>

      <div className="settings-group">
        <div className="settings-group-title">YouTube Data API</div>
        <div className="api-key-row">
          <label htmlFor="youtube-api-key">YouTube Data API v3 Key</label>
          <div className="api-key-input">
            <input
              id="youtube-api-key"
              type={showKey ? 'text' : 'password'}
              value={youtubeApiKey}
              placeholder="Enter YouTube API key..."
              autoComplete="off"
              onChange={(event) => onYouTubeApiKeyChange(event.target.value)}
            />
            <button type="button" onClick={() => setShowKey((visible) => !visible)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <a
            className="api-key-link"
            href="https://console.cloud.google.com/apis/credentials"
            target="_blank"
            rel="noopener noreferrer"
          >
            Get API Key
          </a>
        </div>
      </div>
    </div>
  );
}
