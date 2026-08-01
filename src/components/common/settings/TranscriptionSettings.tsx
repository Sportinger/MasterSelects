import { useSettingsStore, type TranscriptionProvider } from '../../../stores/settingsStore';
import { useAccountStore } from '../../../stores/accountStore';

const providers: { id: TranscriptionProvider; label: string; description: string }[] = [
  { id: 'local', label: 'Local Whisper Base', description: 'Private browser transcription, no API key needed. Slower than cloud.' },
  { id: 'openai', label: 'Hosted OpenAI Whisper', description: 'High-accuracy transcription through MasterSelects credits.' },
  { id: 'deepgram', label: 'Hosted Deepgram', description: 'Nova-3 transcription through MasterSelects credits.' },
  {
    id: 'hybrid',
    label: 'Best Quality — Deepgram Text + OpenAI Speakers',
    description: 'Deepgram supplies the exact text, word timing, and confidence; OpenAI supplies only the speaker separation.',
  },
];

export function TranscriptionSettings() {
  const { transcriptionProvider, setTranscriptionProvider } = useSettingsStore();
  const isSignedIn = useAccountStore((state) => Boolean(state.session?.authenticated));
  const activeProvider = !isSignedIn
    ? 'local'
    : ['openai', 'deepgram', 'hybrid'].includes(transcriptionProvider)
      ? transcriptionProvider
      : 'openai';

  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

      <div className="settings-group">
        <div className="settings-group-title">Provider</div>

        <div className="provider-list">
          {providers.map((provider) => {
            const hostedProvider = provider.id === 'openai'
              || provider.id === 'deepgram'
              || provider.id === 'hybrid';
            const disabled = !isSignedIn && hostedProvider;
            const description = isSignedIn && hostedProvider
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
                {hostedProvider && isSignedIn && (
                  <span className="provider-status">CR</span>
                )}
              </label>
            );
          })}
        </div>
        <p className="settings-hint">
          {isSignedIn
            ? 'Signed-in accounts can use OpenAI, Deepgram, or automatic Best Quality transcription through MasterSelects credits. Timeline clip menus show the active provider before transcription starts.'
            : 'Sign in to use hosted transcription with MasterSelects credits, or select Local Whisper to run on this device.'}
        </p>
      </div>
    </div>
  );
}
