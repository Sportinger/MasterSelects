import type { ContainerFormat } from '../../../engine/export';
import type { FFmpegContainer } from '../../../engine/ffmpeg';
import type { BatchExportMediaType, ExportAudioFormat, ExportImageFormat } from '../../../stores/exportStore';
import { IMAGE_FORMATS } from '../exportSettingsState';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsImageState,
  ExportBasicsModeState,
} from './exportBasicsTypes';
import {
  InspectorSelect,
  type InspectorSelectGroup,
  type InspectorSelectOption,
} from '../../inspector/InspectorSelect';
import {
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
} from './ExportInspectorPrimitives';

interface ExportOutputInspectorSectionProps {
  audio: ExportBasicsAudioState;
  compositionSettingsMatch: boolean;
  display: ExportBasicsDisplayState;
  filename: string;
  filenameLocked?: boolean;
  image: ExportBasicsImageState;
  mode: ExportBasicsModeState;
  onCompositionSettingsMatchChange: (enabled: boolean) => void;
  showCompositionSync: boolean;
  sourceMediaType?: BatchExportMediaType;
  actions: ExportBasicsActions;
}

const VIDEO_CONTAINER_FORMATS = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'mxf', 'gif'] as const;
const ALPHA_VIDEO_CONTAINERS = new Set<(typeof VIDEO_CONTAINER_FORMATS)[number]>([
  'mov', 'mkv', 'avi', 'gif',
]);

function selectedDeliverable(
  mode: ExportBasicsModeState,
  display: ExportBasicsDisplayState,
  image: ExportBasicsImageState,
  audio: ExportBasicsAudioState,
): string {
  if (mode.isXmlMode) return 'xml:fcpxml';
  if (mode.isImageMode) return `image:${image.imageFormat}`;
  if (mode.isAudioOnlyMode) return `audio:${audio.audioOnlyFormat}`;
  return `video:${display.currentContainerId}`;
}

export function ExportOutputInspectorSection({
  audio,
  compositionSettingsMatch,
  display,
  filename,
  filenameLocked = false,
  image,
  mode,
  onCompositionSettingsMatchChange,
  showCompositionSync,
  sourceMediaType,
  actions,
}: ExportOutputInspectorSectionProps) {
  const deliverable = selectedDeliverable(mode, display, image, audio);
  const deliverableGroups: InspectorSelectGroup[] = [];
  if (!sourceMediaType || sourceMediaType === 'video') {
    deliverableGroups.push({
      label: 'Video',
      options: VIDEO_CONTAINER_FORMATS.map(format => ({
        label: `.${format}`,
        supportsAlpha: ALPHA_VIDEO_CONTAINERS.has(format),
        value: `video:${format}`,
      })),
    });
  }
  if (!sourceMediaType || sourceMediaType === 'image') {
    deliverableGroups.push({
      label: 'Image',
      options: IMAGE_FORMATS.map(format => ({
        label: `.${format.id}`,
        supportsAlpha: format.supportsAlpha,
        value: `image:${format.id}`,
      })),
    });
  }
  if (!sourceMediaType || sourceMediaType === 'audio') {
    deliverableGroups.push({
      label: 'Audio',
      options: [
        { label: '.wav', value: 'audio:wav' },
        { label: '.mp3', value: 'audio:mp3' },
        {
          disabled: !mode.isAudioSupported,
          label: `.${display.browserAudioExtension}`,
          value: 'audio:browser',
        },
      ],
    });
  }
  if (!sourceMediaType) {
    deliverableGroups.push({
      label: 'Timeline',
      options: [{ label: '.fcpxml', value: 'xml:fcpxml' }],
    });
  }
  const methodOptions: InspectorSelectOption<ExportBasicsModeState['encoder']>[] = [
    ...(mode.webCodecsAvailable
      ? [
          { label: 'WebCodecs Fast', value: 'webcodecs' as const },
          { label: 'HTMLVideo Precise', value: 'htmlvideo' as const },
        ]
      : []),
    ...(mode.ffmpegAvailable ? [{ label: 'FFmpeg CPU', value: 'ffmpeg' as const }] : []),
    { label: 'HAP GPU', value: 'hap' },
  ];
  const handleDeliverableChange = (value: string) => {
    const [kind, format] = value.split(':');
    actions.setSpecialContainer('none');

    if (kind === 'video') {
      actions.setVideoEnabled(true);
      if (format === 'gif') {
        if (mode.webCodecsAvailable) {
          actions.setEncoder('webcodecs');
        } else {
          actions.setEncoder('ffmpeg');
          actions.handleFFmpegContainerChange('gif');
        }
        actions.setVisualMode('gif');
        actions.setIncludeAudio(false);
        return;
      }

      actions.setVisualMode('video');
      if (format === 'mp4' || format === 'webm') {
        actions.setEncoder('webcodecs');
        actions.setContainerFormat(format as ContainerFormat);
      } else {
        actions.setEncoder('ffmpeg');
        actions.handleFFmpegContainerChange(format as FFmpegContainer);
      }
      return;
    }

    if (kind === 'image') {
      actions.setVideoEnabled(true);
      actions.setVisualMode('image');
      actions.setImageFormat(format as ExportImageFormat);
      return;
    }

    if (kind === 'audio') {
      actions.setVideoEnabled(false);
      actions.setVisualMode('video');
      actions.setIncludeAudio(true);
      actions.setAudioOnlyFormat(format as ExportAudioFormat);
      return;
    }

    actions.setSpecialContainer('xml');
    actions.setVideoEnabled(true);
  };

  return (
    <ExportInspectorSection
      headerActions={showCompositionSync ? (
        <label
          className={`export-composition-sync${compositionSettingsMatch ? ' is-active' : ''}`}
          title="Match composition resolution and frame rate"
        >
          <input
            checked={compositionSettingsMatch}
            onChange={event => onCompositionSettingsMatchChange(event.target.checked)}
            type="checkbox"
          />
          <span aria-hidden="true" className="export-composition-checkmark" />
          <span>Same as composition</span>
        </label>
      ) : undefined}
      target="basic-container"
      title="Output"
    >
      <ExportInspectorRow label="Name" target="basic-output">
        <input
          aria-label="Output name"
          disabled={filenameLocked}
          onChange={event => actions.setFilename(event.target.value)}
          placeholder="export"
          title={filenameLocked ? 'File names stay individual while shared batch settings are active' : undefined}
          type="text"
          value={filename}
        />
      </ExportInspectorRow>

      <ExportInspectorRow label="Container">
        <InspectorSelect
          ariaLabel="Export container"
          groups={deliverableGroups}
          onChange={handleDeliverableChange}
          value={deliverable}
        />
      </ExportInspectorRow>

      {!sourceMediaType && mode.isVideoMode && (
        <ExportInspectorRow label="Method" target="basic-workflow">
          <InspectorSelect
            ariaLabel="Export method"
            onChange={actions.setEncoder}
            options={methodOptions}
            value={mode.encoder}
          />
        </ExportInspectorRow>
      )}

      {mode.encoder === 'ffmpeg' && mode.isVideoMode && !mode.isFFmpegReady && (
        <ExportInspectorRow label="Runtime">
          <button
            className="export-inspector-action-button"
            disabled={mode.isFFmpegLoading}
            onClick={actions.loadFFmpeg}
            type="button"
          >
            {mode.isFFmpegLoading ? 'Loading FFmpeg…' : 'Load FFmpeg Runtime'}
          </button>
        </ExportInspectorRow>
      )}

      {mode.ffmpegLoadError && mode.encoder === 'ffmpeg' && (
        <ExportInspectorNote tone="warning">{mode.ffmpegLoadError}</ExportInspectorNote>
      )}

      {sourceMediaType && (
        <ExportInspectorNote>
          Direct source encoding uses the complete media file. Timeline-only outputs and markers are bypassed.
        </ExportInspectorNote>
      )}
      {mode.isXmlMode && (
        <ExportInspectorNote>
          FCPXML writes the current timeline structure and source references without rendering media.
        </ExportInspectorNote>
      )}
    </ExportInspectorSection>
  );
}
