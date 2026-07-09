import type { ReactNode, RefObject } from 'react';

type GenerationControlPopover =
  | 'model'
  | 'audioModel'
  | 'voice'
  | 'audioOutput'
  | 'voiceSettings'
  | 'sunoModel'
  | 'sunoMode'
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
  modeLabel: string;
  modelButtonLabel: string;
  multiShots: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  selectedEntryHasAspectRatios: boolean;
  selectedEntryHasDurations: boolean;
  selectedEntryHasImageSizes: boolean;
  selectedEntryHasMultipleModes: boolean;
  sunoModelButtonLabel: string;
  sunoModeButtonLabel: string;
  sunoVocalGender: string;
  sunoVocalGenderOptions: Array<{ id: string; label: string }>;
  supportsAudio: boolean;
  supportsMultiShot: boolean;
  voiceSettingsChanged: boolean;
  onAudioToggle: () => void;
  onMultiShotToggle: () => void;
  onOpenPromptBook: () => void;
  onOpenPopover: (type: GenerationControlPopover) => void;
  onSunoVocalGenderChange: (value: string) => void;
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
  modeLabel,
  modelButtonLabel,
  multiShots,
  popoverHostClassName,
  popoverRef,
  selectedEntryHasAspectRatios,
  selectedEntryHasDurations,
  selectedEntryHasImageSizes,
  selectedEntryHasMultipleModes,
  sunoModelButtonLabel,
  sunoModeButtonLabel,
  sunoVocalGender,
  sunoVocalGenderOptions,
  supportsAudio,
  supportsMultiShot,
  voiceSettingsChanged,
  onAudioToggle,
  onMultiShotToggle,
  onOpenPromptBook,
  onOpenPopover,
  onSunoVocalGenderChange,
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
          title="Open generation PromptBook"
        >
          <span className="fb-pill-label">PromptBook</span>
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
                onClick={() => onSunoVocalGenderChange(option.id)}
                title={`Vocal gender: ${option.label}`}
              >
                {option.label}
              </button>
            ))}
            <button
              className={`fb-pill ${activePopover === 'sunoMode' ? 'active' : ''}`}
              onClick={() => onOpenPopover('sunoMode')}
              title="Suno generation mode"
            >
              {sunoModeButtonLabel}
            </button>
          </>
        )}
        {!isAudioMode && selectedEntryHasAspectRatios && (
          <button className={`fb-pill ${activePopover === 'aspect' ? 'active' : ''}`} onClick={() => onOpenPopover('aspect')}>
            {aspectRatioLabel}
          </button>
        )}
        {!isAudioMode && selectedEntryHasDurations && (
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
