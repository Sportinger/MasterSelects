import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';

interface TranscriptionSettingsProps {
  localKeys: { [key: string]: string };
}

const providers: { id: TranscriptionProvider; label: string; description: string }[] = [
  { id: 'local', label: 'Local Whisper Base', description: 'Private browser transcription, no API key needed. Slower than cloud.' },
  { id: 'openai', label: 'OpenAI Whisper API', description: 'High-accuracy speech transcription, $0.006/minute. Requires API key.' },
  { id: 'assemblyai', label: 'AssemblyAI', description: 'Excellent accuracy, speaker diarization. $0.015/minute.' },
  { id: 'deepgram', label: 'Deepgram', description: 'Fast, good accuracy. $0.0125/minute.' },
];

export function TranscriptionSettings({ localKeys }: TranscriptionSettingsProps) {
  const { transcriptionProvider, setTranscriptionProvider } = useSettingsStore();
  const isSignedIn = useAccountStore((state) => Boolean(state.session?.authenticated));
  const activeProvider = isSignedIn ? 'openai' : transcriptionProvider;

  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

      <div className="settings-group">
        <div className="settings-group-title">Provider</div>

        <div className="provider-list">
          {providers.map((provider) => {
            const disabled = isSignedIn && provider.id !== 'openai';
            const description = isSignedIn && provider.id === 'openai'
              ? 'Uses MasterSelects credits for signed-in accounts.'
              : provider.description;

            return (
              <label
                key={provider.id}
                className={[
                  'provider-option',
                  activeProvider === provider.id ? 'active' : '',
                  disabled ? 'disabled' : '',
                ].filter(Boolean).join(' ')}
              >
                <input
                  type="radio"
                  name="transcriptionProvider"
                  value={provider.id}
                  checked={activeProvider === provider.id}
                  disabled={disabled}
                  onChange={() => setTranscriptionProvider(provider.id)}
                />
                <div className="provider-info">
                  <span className="provider-label">{provider.label}</span>
                  <span className="provider-description">{description}</span>
                </div>
                {provider.id !== 'local' && !isSignedIn && localKeys[provider.id] && (
                  <span className="provider-status">{'\u2713'}</span>
                )}
                {provider.id === 'openai' && isSignedIn && (
                  <span className="provider-status">CR</span>
                )}
              </label>
            );
          })}
        </div>
        <p className="settings-hint">
          {isSignedIn
            ? 'Signed-in accounts use OpenAI Whisper Cloud through MasterSelects credits. Timeline clip menus show the active provider before transcription starts.'
            : 'Timeline clip menus show the active provider before transcription starts. API keys for cloud transcription providers can be configured in the API Keys section.'}
        </p>
      </div>
    </div>
  );
}
