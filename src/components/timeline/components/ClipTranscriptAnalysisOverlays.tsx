import { memo } from 'react';
import type { TimelineClip } from '../../../types';
import { ClipAnalysisOverlay } from './ClipAnalysisOverlay';

interface ClipTranscriptAnalysisOverlaysProps {
  enabled: boolean;
  showTranscriptMarkers: boolean;
  clip: TimelineClip;
  displayDuration: number;
  displayStartTime: number;
  width: number;
  trackBaseHeight: number;
  isAudioClip: boolean;
}

export const ClipTranscriptAnalysisOverlays = memo(function ClipTranscriptAnalysisOverlays({
  enabled,
  showTranscriptMarkers,
  clip,
  displayDuration,
  displayStartTime,
  width,
  trackBaseHeight,
  isAudioClip,
}: ClipTranscriptAnalysisOverlaysProps) {
  if (!enabled) return null;

  return (
    <>
      {showTranscriptMarkers && clip.transcript && clip.transcript.length > 0 && (
        <div className="clip-transcript-markers">
          {clip.transcript.map((word) => {
            const wordStartInClip = word.start - clip.inPoint;
            const wordEndInClip = word.end - clip.inPoint;

            if (wordEndInClip < 0 || wordStartInClip > displayDuration) {
              return null;
            }

            const markerStart = Math.max(0, wordStartInClip);
            const markerEnd = Math.min(displayDuration, wordEndInClip);
            const markerLeft = (markerStart / displayDuration) * 100;
            const markerWidth = ((markerEnd - markerStart) / displayDuration) * 100;

            return (
              <div
                key={word.id}
                className="transcript-marker"
                style={{
                  left: `${markerLeft}%`,
                  width: `${Math.max(0.5, markerWidth)}%`,
                }}
                title={word.text}
              />
            );
          })}
        </div>
      )}
      {clip.transcriptStatus === 'transcribing' && (
        <div className="clip-transcribing-indicator">
          <div className="transcribing-progress" style={{ width: `${clip.transcriptProgress || 0}%` }} />
        </div>
      )}
      {!isAudioClip && clip.analysis && (clip.analysisStatus === 'ready' || clip.analysisStatus === 'analyzing') && (
        <>
          <div className="analysis-legend-labels">
            <span className="legend-focus">Focus</span>
            <span className="legend-motion">Motion</span>
            {clip.analysisStatus === 'analyzing' && (
              <span className="legend-progress">{clip.analysisProgress || 0}%</span>
            )}
          </div>
          <div className="clip-analysis-overlay">
            <ClipAnalysisOverlay
              analysis={clip.analysis}
              clipDuration={displayDuration}
              clipInPoint={clip.inPoint}
              clipStartTime={displayStartTime}
              width={width}
              height={trackBaseHeight}
            />
          </div>
        </>
      )}
      {clip.analysisStatus === 'analyzing' && (
        <div className="clip-analyzing-indicator">
          <div className="analyzing-progress" style={{ width: `${clip.analysisProgress || 0}%` }} />
        </div>
      )}
    </>
  );
});
