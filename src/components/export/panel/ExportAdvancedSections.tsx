import { ExportAdvancedAudioSection } from './ExportAdvancedAudioSection';
import { ExportAdvancedVideoSection } from './ExportAdvancedVideoSection';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';

interface ExportAdvancedSectionsProps {
  filename: string;
  mode: ExportBasicsModeState;
  display: ExportBasicsDisplayState;
  video: ExportBasicsVideoState;
  gif: ExportBasicsGifState;
  audio: ExportBasicsAudioState;
  options: ExportBasicsOptionState;
  actions: ExportBasicsActions;
}

export function ExportAdvancedSections({
  filename,
  mode,
  display,
  video,
  gif,
  audio,
  options,
  actions,
}: ExportAdvancedSectionsProps) {
  return (
    <>
      <ExportAdvancedVideoSection
        filename={filename}
        mode={mode}
        display={display}
        video={video}
        gif={gif}
        options={options}
        actions={actions}
      />

      <ExportAdvancedAudioSection
        mode={mode}
        display={display}
        video={video}
        audio={audio}
        actions={actions}
      />
    </>
  );
}
