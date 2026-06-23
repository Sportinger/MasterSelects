interface VoicePanelOption {
  id: string;
  name: string;
  meta: string;
  previewUrl?: string;
}

interface FlashBoardElevenLabsVoicePanelProps {
  emptyMessage: string;
  error: string | null;
  isLoading: boolean;
  search: string;
  selectedVoiceId: string;
  voiceId: string;
  voiceName: string;
  voices: VoicePanelOption[];
  onPreviewVoice: (previewUrl: string | undefined) => void;
  onRefresh: () => void;
  onSearchChange: (value: string) => void;
  onSelectVoice: (voiceId: string) => void;
  onVoiceIdChange: (value: string) => void;
  onVoiceNameChange: (value: string) => void;
}

export function FlashBoardElevenLabsVoicePanel({
  emptyMessage,
  error,
  isLoading,
  search,
  selectedVoiceId,
  voiceId,
  voiceName,
  voices,
  onPreviewVoice,
  onRefresh,
  onSearchChange,
  onSelectVoice,
  onVoiceIdChange,
  onVoiceNameChange,
}: FlashBoardElevenLabsVoicePanelProps) {
  return (
    <div className="fb-elevenlabs-panel">
      <div className="fb-elevenlabs-panel-header">
        <span>Voice</span>
        <button className="fb-pill" type="button" onClick={onRefresh}>
          Refresh
        </button>
      </div>
      <input
        className="fb-pill-input fb-voice-search"
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder="Search voices"
      />
      <div className="fb-voice-list fb-elevenlabs-voice-list">
        {isLoading && <div className="fb-voice-empty">Loading voices...</div>}
        {!isLoading && error && <div className="fb-voice-empty">{error}</div>}
        {!isLoading && !error && voices.length === 0 && <div className="fb-voice-empty">{emptyMessage}</div>}
        {!isLoading && !error && voices.map((voice) => (
          <div
            key={voice.id}
            className={`fb-voice-item ${voice.id === selectedVoiceId ? 'active' : ''}`}
          >
            <button
              className="fb-voice-main"
              type="button"
              onClick={() => onSelectVoice(voice.id)}
            >
              <span className="fb-voice-name">{voice.name}</span>
              <span className="fb-voice-meta">{voice.meta}</span>
            </button>
            {voice.previewUrl && (
              <button className="fb-pill" type="button" onClick={() => onPreviewVoice(voice.previewUrl)}>
                Preview
              </button>
            )}
          </div>
        ))}
      </div>
      <div className="fb-elevenlabs-voice-fields">
        <label className="fb-audio-popover-field">
          <span>Voice ID</span>
          <input
            className="fb-pill-input"
            value={voiceId}
            onChange={(event) => onVoiceIdChange(event.target.value)}
            placeholder="ElevenLabs voice_id"
          />
        </label>
        <label className="fb-audio-popover-field">
          <span>Voice name</span>
          <input
            className="fb-pill-input"
            value={voiceName}
            onChange={(event) => onVoiceNameChange(event.target.value)}
            placeholder="Optional label"
          />
        </label>
      </div>
    </div>
  );
}
