import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';

interface TranscriptionSettingsProps {
  localKeys: { [key: string]: string };
}

const providers: { id: TranscriptionProvider; label: string; description: string }[] = [
  { id: 'local', label: 'Local (Whisper)', description: 'Runs in browser, no API key needed. Slower, less accurate.' },
  { id: 'openai', label: 'OpenAI Whisper API', description: 'High accuracy, $0.006/minute. Requires API key.' },
  { id: 'assemblyai', label: 'AssemblyAI', description: 'Excellent accuracy, speaker diarization. $0.015/minute.' },
  { id: 'deepgram', label: 'Deepgram', description: 'Fast, good accuracy. $0.0125/minute.' },
];

export function TranscriptionSettings({ localKeys }: TranscriptionSettingsProps) {
  const { transcriptionProvider, setTranscriptionProvider } = useSettingsStore();

  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

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
              {provider.id !== 'local' && localKeys[provider.id] && (
                <span className="provider-status">{'\u2713'}</span>
              )}
            </label>
          ))}
        </div>
        <p className="settings-hint">
          API keys for transcription providers can be configured in the API Keys section.
        </p>
      </div>
    </div>
  );
}
