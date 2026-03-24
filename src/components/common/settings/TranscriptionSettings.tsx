import { useCallback, useState, useEffect } from 'react';
import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';
import { lemonadeWhisperService } from '../../../services/lemonadeWhisperService';

const providers: { id: TranscriptionProvider; label: string; description: string }[] = [
  { id: 'local', label: 'Local (Whisper)', description: 'Runs in browser, no API key needed. Slower, less accurate.' },
  { id: 'openai', label: 'OpenAI Whisper API', description: 'High accuracy, $0.006/minute. Requires API key.' },
  { id: 'assemblyai', label: 'AssemblyAI', description: 'Excellent accuracy, speaker diarization. $0.015/minute.' },
  { id: 'deepgram', label: 'Deepgram', description: 'Fast, good accuracy. $0.0125/minute.' },
  { id: 'lemonade', label: 'Lemonade Server (whisper.cpp)', description: 'Server-side, fast, uses GPU/NPU. Requires Lemonade Server running.' },
];

export function TranscriptionSettings() {
  const {
    transcriptionProvider,
    setTranscriptionProvider,
    apiKeys,
    lemonadeTranscriptionEnabled,
    setLemonadeTranscriptionEnabled,
    lemonadeTranscriptionFallback,
    setLemonadeTranscriptionFallback,
  } = useSettingsStore();

  const [serverStatus, setServerStatus] = useState<'online' | 'offline' | 'checking'>('checking');

  // Subscribe to Lemonade Server status
  useEffect(() => {
    // Initial check
    lemonadeWhisperService.checkServerHealth().then(result => {
      setServerStatus(result.available ? 'online' : 'offline');
    });
  }, []);

  const handleRefreshStatus = useCallback(() => {
    lemonadeWhisperService.refreshServerStatus().then(available => {
      setServerStatus(available ? 'online' : 'offline');
    });
  }, []);

  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

      {/* Lemonade Server Transcription */}
      <div className="settings-group">
        <div className="settings-group-title">Lemonade Server Transcription</div>

        <div className="lemonade-transcription-section">
          <label className="lemonade-toggle">
            <input
              type="checkbox"
              checked={lemonadeTranscriptionEnabled}
              onChange={(e) => setLemonadeTranscriptionEnabled(e.target.checked)}
            />
            <span>Use Lemonade Server for transcription (faster, server-side)</span>
          </label>

          {lemonadeTranscriptionEnabled && (
            <div className="lemonade-options">
              <div className={`server-status ${serverStatus}`}>
                <span className="status-dot"></span>
                <span className="status-text">
                  {serverStatus === 'online' && 'Server online'}
                  {serverStatus === 'offline' && 'Server offline'}
                  {serverStatus === 'checking' && 'Checking...'}
                </span>
              </div>

              <label className="lemonade-fallback">
                <input
                  type="checkbox"
                  checked={lemonadeTranscriptionFallback}
                  onChange={(e) => setLemonadeTranscriptionFallback(e.target.checked)}
                  disabled={serverStatus === 'online'}
                />
                <span>Fall back to local transcription if server is offline</span>
              </label>

              <button
                className="settings-button"
                onClick={handleRefreshStatus}
                disabled={serverStatus === 'checking'}
              >
                Refresh Status
              </button>

              <p className="settings-hint">
                Lemonade Server must be running on port 8000 with whisper.cpp support.
                Transcription uses server GPU/NPU for faster processing.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Provider Selection (shown when Lemonade is disabled) */}
      {!lemonadeTranscriptionEnabled && (
        <div className="settings-group">
          <div className="settings-group-title">Provider</div>

          <div className="provider-list">
            {providers.map((provider) => (
              <label
                key={provider.id}
                className={`provider-option ${transcriptionProvider === provider.id ? 'active' : ''}`}
              >
                <input
                  type="radio"
                  name="transcriptionProvider"
                  value={provider.id}
                  checked={transcriptionProvider === provider.id}
                  onChange={() => setTranscriptionProvider(provider.id)}
                />
                <div className="provider-info">
                  <span className="provider-label">{provider.label}</span>
                  <span className="provider-description">{provider.description}</span>
                </div>
                {provider.id !== 'local' && provider.id !== 'lemonade' && apiKeys[provider.id as keyof typeof apiKeys] && (
                  <span className="provider-status">{'\u2713'}</span>
                )}
              </label>
            ))}
          </div>
          <p className="settings-hint">
            API keys for transcription providers can be configured in the API Keys section.
          </p>
        </div>
      )}
    </div>
  );
}
