interface TranscriptionSettingsProps {
  localKeys: { [key: string]: string };
}

export function TranscriptionSettings({}: TranscriptionSettingsProps) {
  return (
    <div className="settings-category-content">
      <h2>Transcription</h2>

      <div className="settings-group">
        <div className="settings-group-title">Provider</div>

        <div className="provider-list">
          <label className="provider-option active">
            <input
              type="radio"
              name="transcriptionProvider"
              value="local"
              checked={true}
              readOnly
            />
            <div className="provider-info">
              <span className="provider-label">Local (Whisper)</span>
              <span className="provider-description">Runs in browser using WebGPU. No API key needed.</span>
            </div>
          </label>
        </div>
        <p className="settings-hint">
          Transcription runs locally in your browser using Whisper via WebGPU.
        </p>
      </div>
    </div>
  );
}
