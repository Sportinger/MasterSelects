type VoiceSettingKey = 'speed' | 'stability' | 'similarityBoost' | 'style';

interface SelectOption {
  id: string;
  label: string;
}

interface VoiceSettingsValue {
  speed: number;
  stability: number;
  similarityBoost: number;
  style: number;
  useSpeakerBoost: boolean;
}

interface FlashBoardElevenLabsSettingsPopoversProps {
  activePopover: string | null;
  isElevenLabsMode: boolean;
  languageCode: string;
  languageOverride: boolean;
  modelId: string;
  modelMetaText?: string;
  modelOptions: SelectOption[];
  outputFormat: string;
  outputOptions: SelectOption[];
  voiceSettings: VoiceSettingsValue;
  onLanguageCodeChange: (value: string) => void;
  onLanguageOverrideChange: (value: boolean) => void;
  onModelChange: (modelId: string) => void;
  onOutputFormatChange: (value: string) => void;
  onResetVoiceSettings: () => void;
  onSpeakerBoostChange: (value: boolean) => void;
  onVoiceSettingNumberChange: (key: VoiceSettingKey, value: string) => void;
}

const VOICE_SETTING_CONTROLS: Array<{
  key: VoiceSettingKey;
  label: string;
  min: number;
  max: number;
}> = [
  { key: 'speed', label: 'Speed', min: 0.7, max: 1.2 },
  { key: 'stability', label: 'Stability', min: 0, max: 1 },
  { key: 'similarityBoost', label: 'Similarity', min: 0, max: 1 },
  { key: 'style', label: 'Style', min: 0, max: 1 },
];

export function FlashBoardElevenLabsSettingsPopovers({
  activePopover,
  isElevenLabsMode,
  languageCode,
  languageOverride,
  modelId,
  modelMetaText,
  modelOptions,
  outputFormat,
  outputOptions,
  voiceSettings,
  onLanguageCodeChange,
  onLanguageOverrideChange,
  onModelChange,
  onOutputFormatChange,
  onResetVoiceSettings,
  onSpeakerBoostChange,
  onVoiceSettingNumberChange,
}: FlashBoardElevenLabsSettingsPopoversProps) {
  if (!isElevenLabsMode) {
    return null;
  }

  return (
    <>
      {activePopover === 'audioModel' && (
        <div className="fb-popover fb-popover-audio">
          <div className="fb-popover-title">ElevenLabs Model</div>
          <label className="fb-audio-popover-field">
            <span>Text-to-speech model</span>
            <select
              className="fb-pill-select"
              value={modelId}
              onChange={(event) => onModelChange(event.target.value)}
            >
              {modelOptions.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </label>
          {modelMetaText && (
            <div className="fb-audio-model-meta">{modelMetaText}</div>
          )}
        </div>
      )}

      {activePopover === 'audioOutput' && (
        <div className="fb-popover fb-popover-audio">
          <div className="fb-popover-title">Output</div>
          <div className="fb-audio-popover-grid">
            <label className="fb-audio-popover-field">
              <span>Format</span>
              <select
                className="fb-pill-select"
                value={outputFormat}
                onChange={(event) => onOutputFormatChange(event.target.value)}
              >
                {outputOptions.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="fb-audio-popover-field fb-audio-language">
              <input
                type="checkbox"
                checked={languageOverride}
                onChange={(event) => onLanguageOverrideChange(event.target.checked)}
              />
              <span>Language override</span>
              <input
                value={languageCode}
                onChange={(event) => onLanguageCodeChange(event.target.value)}
                placeholder="en"
                disabled={!languageOverride}
              />
            </label>
          </div>
        </div>
      )}

      {activePopover === 'voiceSettings' && (
        <div className="fb-popover fb-popover-audio">
          <div className="fb-popover-title">Voice Settings</div>
          <div className="fb-audio-popover-grid">
            {VOICE_SETTING_CONTROLS.map((control) => (
              <label className="fb-audio-popover-field" key={control.key}>
                <span>{control.label} {voiceSettings[control.key].toFixed(2)}</span>
                <input
                  type="range"
                  min={control.min}
                  max={control.max}
                  step={0.01}
                  value={voiceSettings[control.key]}
                  onChange={(event) => onVoiceSettingNumberChange(control.key, event.target.value)}
                />
              </label>
            ))}
          </div>
          <div className="fb-audio-actions">
            <label className="fb-pill-check">
              <input
                type="checkbox"
                checked={voiceSettings.useSpeakerBoost}
                onChange={(event) => onSpeakerBoostChange(event.target.checked)}
              />
              <span>Speaker boost</span>
            </label>
            <button className="fb-pill" type="button" onClick={onResetVoiceSettings}>
              Reset voice
            </button>
          </div>
        </div>
      )}
    </>
  );
}
