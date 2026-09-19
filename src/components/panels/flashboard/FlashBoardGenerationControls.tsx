import type { ReactNode, RefObject } from 'react';

type GenerationControlPopover =
  | 'model'
  | 'audioModel'
  | 'voice'
  | 'audioOutput'
  | 'voiceSettings'
  | 'sunoModel'
  | 'aspect'
  | 'duration'
  | 'imageSize'
  | 'mode';

interface FlashBoardGenerationControlsProps {
  activePopover: string | null;
  aspectRatioLabel: string;
  audioModelButtonLabel: string;
  audioOutputButtonLabel: string;
  children: ReactNode;
  durationLabel: string;
  effectiveGenerateAudio: boolean;
  imageSizeLabel: string;
  isAudioMode: boolean;
  isElevenLabsMode: boolean;
  isSunoMode: boolean;
  isSeedance25Mode: boolean;
  modeLabel: string;
  modelButtonLabel: string;
  multiShots: boolean;
  returnLastFrame: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  selectedEntryHasAspectRatios: boolean;
  selectedEntryHasDurations: boolean;
  selectedEntryHasImageSizes: boolean;
  selectedEntryHasMultipleModes: boolean;
  sunoModelButtonLabel: string;
  sunoVocalGender: string;
  sunoVocalGenderOptions: Array<{ id: string; label: string }>;
  sunoVoiceControlsDisabled: boolean;
  supportsAudio: boolean;
  supportsMultiShot: boolean;
  videoOutputFormat: 'mov' | 'mp4';
  voiceSettingsChanged: boolean;
  webSearch: boolean;
  onAudioToggle: () => void;
  onMultiShotToggle: () => void;
  onReturnLastFrameToggle: () => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (type: GenerationControlPopover) => void;
  onSunoVocalGenderChange: (value: string) => void;
  onVideoOutputFormatToggle: () => void;
  onWebSearchToggle: () => void;
}

export function FlashBoardGenerationControls({
  activePopover,
  aspectRatioLabel,
  audioModelButtonLabel,
  audioOutputButtonLabel,
  children,
  durationLabel,
  effectiveGenerateAudio,
  imageSizeLabel,
  isAudioMode,
  isElevenLabsMode,
  isSunoMode,
  isSeedance25Mode,
  modeLabel,
  modelButtonLabel,
  multiShots,
  returnLastFrame,
  popoverHostClassName,
  popoverRef,
  selectedEntryHasAspectRatios,
  selectedEntryHasDurations,
  selectedEntryHasImageSizes,
  selectedEntryHasMultipleModes,
  sunoModelButtonLabel,
  sunoVocalGender,
  sunoVocalGenderOptions,
  sunoVoiceControlsDisabled,
  supportsAudio,
  supportsMultiShot,
  videoOutputFormat,
  voiceSettingsChanged,
  webSearch,
  onAudioToggle,
  onMultiShotToggle,
  onReturnLastFrameToggle,
  onOpenPromptBook,
  onOpenPopover,
  onSunoVocalGenderChange,
  onVideoOutputFormatToggle,
  onWebSearchToggle,
}: FlashBoardGenerationControlsProps) {
  return (
    <div className="fb-control-stack">
      <div className={`${popoverHostClassName} ${isSunoMode ? 'is-suno-controls' : ''}`} ref={popoverRef}>
        <button
          className={`fb-pill fb-model-select-pill ${activePopover === 'model' ? 'active' : ''}`}
          onClick={() => onOpenPopover('model')}
          title={`Model: ${modelButtonLabel}`}
        >
          Model
        </button>
        <button
          className="fb-pill fb-prompt-book-pill"
          type="button"
          onClick={onOpenPromptBook}
          title="Open generation Prompt Book"
        >
          <span className="fb-pill-label">Prompt Book</span>
        </button>
        {isElevenLabsMode && (
          <>
            <button
              className={`fb-pill ${activePopover === 'audioModel' ? 'active' : ''}`}
              onClick={() => onOpenPopover('audioModel')}
              title="ElevenLabs text-to-speech model"
            >
              {audioModelButtonLabel}
            </button>
            <button
              className={`fb-pill ${activePopover === 'audioOutput' ? 'active' : ''}`}
              onClick={() => onOpenPopover('audioOutput')}
              title="Output"
            >
              {audioOutputButtonLabel}
            </button>
            <button
              className={`fb-pill ${activePopover === 'voiceSettings' || voiceSettingsChanged ? 'active' : ''}`}
              onClick={() => onOpenPopover('voiceSettings')}
              title="Voice settings"
            >
              Settings
            </button>
          </>
        )}
        {isSunoMode && (
          <>
            <button
              className={`fb-pill ${activePopover === 'sunoModel' ? 'active' : ''}`}
              onClick={() => onOpenPopover('sunoModel')}
              title="Suno model"
            >
              {sunoModelButtonLabel}
            </button>
            <button
              className={`fb-pill fb-suno-vocal-pill ${sunoVocalGender === '' ? 'active' : ''}`}
              type="button"
              disabled={sunoVoiceControlsDisabled}
              onClick={() => onSunoVocalGenderChange('')}
              title="Automatic vocal gender"
            >
              Auto vocal
            </button>
            {sunoVocalGenderOptions.map((option) => (
              <button
                key={option.id}
                className={`fb-pill fb-suno-vocal-pill ${sunoVocalGender === option.id ? 'active' : ''}`}
                type="button"
                disabled={sunoVoiceControlsDisabled}
                onClick={() => onSunoVocalGenderChange(option.id)}
                title={`Vocal gender: ${option.label}`}
              >
                {option.label}
              </button>
            ))}
          </>
        )}
        {!isAudioMode && selectedEntryHasAspectRatios && (
          <button className={`fb-pill ${activePopover === 'aspect' ? 'active' : ''}`} onClick={() => onOpenPopover('aspect')}>
            {aspectRatioLabel}
          </button>
        )}
        {selectedEntryHasDurations && (!isAudioMode || isSunoMode) && (
          <button className={`fb-pill ${activePopover === 'duration' ? 'active' : ''}`} onClick={() => onOpenPopover('duration')}>
            {durationLabel}
          </button>
        )}
        {!isAudioMode && selectedEntryHasImageSizes && (
          <button className={`fb-pill ${activePopover === 'imageSize' ? 'active' : ''}`} onClick={() => onOpenPopover('imageSize')}>
            {imageSizeLabel}
          </button>
        )}
        {selectedEntryHasMultipleModes && (
          <button className={`fb-pill ${activePopover === 'mode' ? 'active' : ''}`} onClick={() => onOpenPopover('mode')}>
            {modeLabel}
          </button>
        )}
        {supportsAudio && (
          <button className={`fb-pill ${effectiveGenerateAudio ? 'active' : ''}`} onClick={onAudioToggle} title={multiShots ? 'Required for multishot' : 'Generate sound'}>
            {multiShots ? 'Sound req.' : 'Sound'}
          </button>
        )}
        {isSeedance25Mode && (
          <>
            <button className={`fb-pill ${videoOutputFormat === 'mov' ? 'active' : ''}`} onClick={onVideoOutputFormatToggle} title="Toggle Seedance output format">
              {videoOutputFormat.toUpperCase()}
            </button>
            <button className={`fb-pill ${webSearch ? 'active' : ''}`} onClick={onWebSearchToggle} title="Use web search during generation">
              Web search
            </button>
            <button className={`fb-pill ${returnLastFrame ? 'active' : ''}`} onClick={onReturnLastFrameToggle} title="Import the generated last frame alongside the video">
              Last frame
            </button>
          </>
        )}
        {supportsMultiShot && (
          <button className={`fb-pill ${multiShots ? 'active' : ''}`} onClick={onMultiShotToggle} title="Split the generation into multiple shots">
            Multi-shot
          </button>
        )}
        {children}
      </div>
      <div className="fb-selected-model-label" title={modelButtonLabel}>
        {modelButtonLabel}
      </div>
    </div>
  );
}
