import { useMemo, useState } from 'react';
import { layerBuilder } from '../../../services/layerBuilder';
import { renderHostPort } from '../../../services/render/renderHostPort';
import { deleteCaptionTimelineRange } from '../../../services/captions/captionTimelineEditing';
import { getCaptionSourceCandidates } from '../../../services/captions/captionRuntime';
import { createCaptionTimelineTranscript } from '../../../services/captions/captionTimelineTranscript';
import { correctTranscriptWordFromCaption } from '../../../services/transcription/artifactPersistence';
import { useTimelineStore } from '../../../stores/timeline';
import { TimelineTranscriptEditor } from './TimelineTranscriptEditor';

interface CaptionTranscriptPanelProps {
  captionClipId: string;
}

export function CaptionTranscriptPanel({ captionClipId }: CaptionTranscriptPanelProps) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);
  const updateCaptionProperties = useTimelineStore(state => state.updateCaptionProperties);
  const invalidateCache = useTimelineStore(state => state.invalidateCache);
  const [expanded, setExpanded] = useState(true);
  const captionClip = clips.find(clip => clip.id === captionClipId);
  const sources = useMemo(
    () => getCaptionSourceCandidates(clips, captionClipId),
    [captionClipId, clips],
  );
  const sourceIds = new Set(sources.map(source => source.clip.id));
  const selectedSourceId = captionClip?.captionProperties?.sourceClipId;
  const sourceValue = selectedSourceId && sourceIds.has(selectedSourceId)
    ? selectedSourceId
    : 'auto';
  const events = useMemo(() => (
    captionClip
      ? createCaptionTimelineTranscript({ captionClip, clips, tracks })
      : []
  ), [captionClip, clips, tracks]);
  const wordCount = events.filter(event => event.kind === 'word').length;
  const pauseCount = events.length - wordCount;

  return (
    <details
      className="caption-transcript-panel properties-section"
      open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}
    >
      <summary className="caption-transcript-summary">
        <span>Transcript</span>
        <select
          className="caption-transcript-source-select"
          aria-label="Transcript source"
          value={sourceValue}
          onClick={event => event.stopPropagation()}
          onKeyDown={event => event.stopPropagation()}
          onChange={event => updateCaptionProperties(captionClipId, {
            sourceClipId: event.target.value === 'auto' ? null : event.target.value,
          })}
          onWheel={event => event.currentTarget.blur()}
          title="Transcript source"
        >
          <option value="auto">Auto</option>
          {sources.map(({ clip: sourceClip }) => (
            <option key={sourceClip.id} value={sourceClip.id}>
              {sourceClip.name}
            </option>
          ))}
        </select>
        <span className="caption-transcript-count">
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
          {pauseCount > 0 ? ` · ${pauseCount} ${pauseCount === 1 ? 'pause' : 'pauses'}` : ''}
        </span>
      </summary>
      <TimelineTranscriptEditor
        ariaLabel="Caption transcript"
        emptyMessage="No transcript words are visible in this Caption clip."
        events={events}
        onCorrectWord={(event, text) => {
          const result = correctTranscriptWordFromCaption({
            sourceClipId: event.sourceClipId,
            wordId: event.wordId,
            text,
          });
          if (result.ok) {
            invalidateCache();
            layerBuilder.invalidateCache();
            renderHostPort.requestNewFrameRender();
          }
          return result;
        }}
        onDeleteRange={(event, label) => deleteCaptionTimelineRange({
          captionClipId,
          sourceClipId: event.sourceClipId,
          timelineStart: event.timelineStart,
          timelineEnd: event.timelineEnd,
          label,
        })}
        playheadPosition={playheadPosition}
        setPlayheadPosition={setPlayheadPosition}
      />
    </details>
  );
}
