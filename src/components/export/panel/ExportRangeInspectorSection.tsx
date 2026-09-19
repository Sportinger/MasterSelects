import type { BatchExportMediaType } from '../../../stores/exportStore';
import type {
  ExportBasicsActions,
  ExportBasicsDisplayState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './exportBasicsTypes';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import {
  ExportInspectorNote,
  ExportInspectorRow,
  ExportInspectorSection,
} from './ExportInspectorPrimitives';

interface ExportRangeInspectorSectionProps {
  actions: ExportBasicsActions;
  display: ExportBasicsDisplayState;
  image: ExportBasicsImageState;
  mode: ExportBasicsModeState;
  sourceMediaType?: BatchExportMediaType;
  time: ExportBasicsTimeState;
  useInOut: boolean;
  video: ExportBasicsVideoState;
}

export function ExportRangeInspectorSection({
  actions,
  display,
  image,
  mode,
  sourceMediaType,
  time,
  useInOut,
  video,
}: ExportRangeInspectorSectionProps) {
  const fixedSourceRange = sourceMediaType !== undefined;
  const currentFrameOnly = mode.isImageMode && !mode.isImageSequenceMode;
  const duration = Math.max(0, time.endTime - time.startTime);

  return (
    <ExportInspectorSection defaultOpen={false} target="range-section" title="Range & Summary">
      <ExportInspectorRow label="Range">
        {fixedSourceRange ? (
          <span className="export-inspector-static">Full source</span>
        ) : currentFrameOnly ? (
          <span className="export-inspector-static">Current frame · {time.formatTime(time.playheadPosition)}</span>
        ) : (
          <InspectorSelect
            ariaLabel="Export range"
            onChange={value => actions.setUseInOut(value === 'in-out')}
            options={[
              { label: 'Full timeline', value: 'full' },
              { label: 'In / Out markers', value: 'in-out' },
            ]}
            value={useInOut ? 'in-out' : 'full'}
          />
        )}
      </ExportInspectorRow>

      {!currentFrameOnly && (
        <ExportInspectorRow label="Timecode">
          <span className="export-inspector-static">{time.formatTime(time.startTime)} – {time.formatTime(time.endTime)}</span>
        </ExportInspectorRow>
      )}

      {!currentFrameOnly && (
        <ExportInspectorRow label="Duration">
          <span className="export-inspector-static">{time.formatTime(duration)}</span>
        </ExportInspectorRow>
      )}

      {(mode.isVideoMode || mode.isImageSequenceMode) && (
        <ExportInspectorRow label="Frames">
          <span className="export-inspector-static">
            {mode.isImageSequenceMode ? image.imageSequenceFrameCount : video.frameCount}
          </span>
        </ExportInspectorRow>
      )}

      {(mode.isVideoMode || mode.isImageMode) && (
        <ExportInspectorRow label="Output">
          <span className="export-inspector-static">{video.actualWidth} × {video.outputHeight}</span>
        </ExportInspectorRow>
      )}

      {!mode.isXmlMode && (
        <ExportInspectorRow label={display.sizeStatLabel}>
          <span className="export-inspector-static">{display.estimatedSizeLabel}</span>
        </ExportInspectorRow>
      )}

      {mode.isImageSequenceMode && (
        <ExportInspectorNote>
          {mode.imageSequenceFolderSupported
            ? `Numbered frames will be written to a selected ${mode.imageSequenceOutputLabel}.`
            : 'The browser will create a ZIP because direct folder writes are unavailable.'}
        </ExportInspectorNote>
      )}
    </ExportInspectorSection>
  );
}
