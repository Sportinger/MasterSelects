import type { BatchExportMediaType } from '../../../stores/exportStore';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
} from './exportBasicsTypes';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import {
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
  ExportInspectorToggle,
} from './ExportInspectorPrimitives';

interface ExportAudioInspectorSectionProps {
  actions: ExportBasicsActions;
  audio: ExportBasicsAudioState;
  display: ExportBasicsDisplayState;
  mode: ExportBasicsModeState;
  options: ExportBasicsOptionState;
  sourceMediaType?: BatchExportMediaType;
}

export function ExportAudioInspectorSection({
  actions,
  audio,
  display,
  mode,
  options,
  sourceMediaType,
}: ExportAudioInspectorSectionProps) {
  const audioAvailable = !mode.isImageMode && !mode.isGifMode;
  const audioEnabled = audioAvailable && audio.includeAudio;
  const canToggle = audioAvailable
    && !mode.browserAudioUnavailable
    && (!sourceMediaType || sourceMediaType === 'video');
  const isPcm = mode.isAudioOnlyMode && audio.audioOnlyFormat === 'wav';

  return (
    <ExportInspectorSection
      defaultOpen={audioEnabled}
      enabled={audioEnabled}
      indicator={audioEnabled ? 'active' : 'inactive'}
      onEnabledChange={canToggle ? actions.setIncludeAudio : undefined}
      target="audio-section"
      title="Audio"
    >
      {!audioAvailable ? (
        <ExportInspectorNote>{mode.isGifMode ? 'GIF export is silent.' : 'Still images and image sequences do not include audio.'}</ExportInspectorNote>
      ) : !audio.includeAudio ? (
        <ExportInspectorNote>Audio is disabled. The exported video will be silent.</ExportInspectorNote>
      ) : (
        <>
          <ExportInspectorRow label="Codec" target="audio-format">
            {mode.isAudioOnlyMode ? (
              <InspectorSelect
                ariaLabel="Audio format"
                onChange={value => actions.setAudioOnlyFormat(value as ExportBasicsAudioState['audioOnlyFormat'])}
                options={[
                  { label: 'WAV PCM', value: 'wav' },
                  { label: 'MP3', value: 'mp3' },
                  {
                    disabled: !mode.isAudioSupported,
                    label: display.browserAudioCodecLabel,
                    value: 'browser',
                  },
                ]}
                value={audio.audioOnlyFormat}
              />
            ) : (
              <span className="export-inspector-static">{display.currentAudioCodecLabel}</span>
            )}
          </ExportInspectorRow>

          <ExportInspectorRow label="Sample Rate">
            <InspectorSelect
              ariaLabel="Audio sample rate"
              onChange={value => actions.setAudioSampleRate(Number(value) as 44100 | 48000)}
              options={options.audioSampleRatePresets.map(preset => ({
                label: preset.label,
                value: String(preset.value),
              }))}
              value={String(audio.audioSampleRate)}
            />
          </ExportInspectorRow>

          <ExportInspectorRow label="Bitrate" target="audio-quality">
            {isPcm ? (
              <span className="export-inspector-static">16-bit PCM</span>
            ) : (
              <InspectorSelect
                ariaLabel="Audio bitrate"
                onChange={value => actions.setAudioBitrate(Number(value))}
                options={options.audioBitratePresets.map(preset => ({
                  label: preset.label,
                  value: String(preset.value),
                }))}
                value={String(audio.audioBitrate)}
              />
            )}
          </ExportInspectorRow>

          <ExportInspectorRow label="Processing" target="audio-processing">
            <ExportInspectorToggle
              checked={audio.normalizeAudio}
              disabled={sourceMediaType !== undefined}
              label="Normalize"
              onChange={actions.setNormalizeAudio}
            />
          </ExportInspectorRow>

          {mode.isXmlMode && (
            <ExportInspectorNote>Audio track references are included; no audio file is encoded.</ExportInspectorNote>
          )}
          {mode.browserAudioUnavailable && (
            <ExportInspectorNote tone="warning">Browser audio encoding is not available in this environment.</ExportInspectorNote>
          )}
        </>
      )}
    </ExportInspectorSection>
  );
}
