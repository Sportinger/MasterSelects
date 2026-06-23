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
  isRefiningPrompt: boolean;
  isSunoMode: boolean;
  modeLabel: string;
  modelButtonLabel: string;
  multiShots: boolean;
  popoverHostClassName: string;
  popoverRef: RefObject<HTMLDivElement | null>;
  promptRefineTitle: string;
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
  onOpenPopover: (type: GenerationControlPopover) => void;
  onRefinePrompt: () => void | Promise<void>;
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
  isRefiningPrompt,
  isSunoMode,
  modeLabel,
  modelButtonLabel,
  multiShots,
  popoverHostClassName,
  popoverRef,
  promptRefineTitle,
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
  onOpenPopover,
  onRefinePrompt,
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 1v2m0 18v2M4.22 4.22l1.42 1.42m12.72 12.72l1.42 1.42M1 12h2m18 0h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
          </svg>
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
        {!isElevenLabsMode && (
          <button
            className={`fb-pill fb-pill-icon fb-prompt-refine ${isRefiningPrompt ? 'active is-loading' : ''}`}
            type="button"
            onClick={onRefinePrompt}
            disabled={isRefiningPrompt}
            title={isRefiningPrompt ? 'Refining prompt...' : promptRefineTitle}
            aria-label="Refine prompt"
          >
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.45" aria-hidden="true">
              <path d="M5.5 12.5 13 5" />
              <path d="m10.8 3.2 2 2" />
              <path d="M2.8 1.6 3.3 3l1.5.5-1.5.5-.5 1.4L2.3 4 1 3.5 2.3 3l.5-1.4Z" />
              <path d="m11.8 9.7.4 1.1 1.1.4-1.1.4-.4 1.1-.4-1.1-1.1-.4 1.1-.4.4-1.1Z" />
            </svg>
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
