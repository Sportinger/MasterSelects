import type { BatchExportMediaType } from '../../../stores/exportStore';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';
import { ExportAudioInspectorSection } from './ExportAudioInspectorSection';
import { ExportImageInspectorSection } from './ExportImageInspectorSection';
import { ExportOutputInspectorSection } from './ExportOutputInspectorSection';
import { ExportRangeInspectorSection } from './ExportRangeInspectorSection';
import { ExportVideoInspectorSection } from './ExportVideoInspectorSection';

interface ExportInspectorSectionsProps {
  actions: ExportBasicsActions;
  audio: ExportBasicsAudioState;
  compositionSettingsMatch: boolean;
  display: ExportBasicsDisplayState;
  filename: string;
  filenameLocked?: boolean;
  gif: ExportBasicsGifState;
  image: ExportBasicsImageState;
  mode: ExportBasicsModeState;
  options: ExportBasicsOptionState;
  onCompositionSettingsMatchChange: (enabled: boolean) => void;
  showCompositionSync: boolean;
  sourceMediaType?: BatchExportMediaType;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  video: ExportBasicsVideoState;
}

export function ExportInspectorSections({
  actions,
  audio,
  compositionSettingsMatch,
  display,
  filename,
  filenameLocked,
  gif,
  image,
  mode,
  options,
  onCompositionSettingsMatchChange,
  showCompositionSync,
  sourceMediaType,
  time,
  useInOut,
  video,
}: ExportInspectorSectionsProps) {
  return (
    <div className="export-inspector-sections">
      <ExportOutputInspectorSection
        actions={actions}
        audio={audio}
        compositionSettingsMatch={compositionSettingsMatch}
        display={display}
        filename={filename}
        filenameLocked={filenameLocked}
        image={image}
        mode={mode}
        onCompositionSettingsMatchChange={onCompositionSettingsMatchChange}
        showCompositionSync={showCompositionSync}
        sourceMediaType={sourceMediaType}
      />

      {!mode.isXmlMode && (mode.isImageMode ? (
        <ExportImageInspectorSection
          actions={actions}
          image={image}
          mode={mode}
          options={options}
          sourceMediaType={sourceMediaType}
          video={video}
        />
      ) : (
        <ExportVideoInspectorSection
          actions={actions}
          display={display}
          gif={gif}
          mode={mode}
          options={options}
          sourceMediaType={sourceMediaType}
          video={video}
        />
      ))}

      {!mode.isImageMode && !mode.isGifMode && (
        <ExportAudioInspectorSection
          actions={actions}
          audio={audio}
          display={display}
          mode={mode}
          options={options}
          sourceMediaType={sourceMediaType}
        />
      )}

      <ExportRangeInspectorSection
        actions={actions}
        display={display}
        image={image}
        mode={mode}
        sourceMediaType={sourceMediaType}
        time={time}
        useInOut={useInOut}
        video={video}
      />
    </div>
  );
}
