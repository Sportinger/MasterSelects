import { memo } from 'react';
import type { TimelineClip } from '../../../types';
import type { MediaFile } from '../../../stores/mediaStore/types';
import {
  resolveAnalysisCoveragePercent,
  resolveTranscriptCoveragePercent,
} from '../utils/clipCoverageBadges';

interface ClipCoverageBadgesProps {
  enabled: boolean;
  clip: TimelineClip;
  mediaFiles: readonly MediaFile[];
  isAudioClip: boolean;
}

export const ClipCoverageBadges = memo(function ClipCoverageBadges({
  enabled,
  clip,
  mediaFiles,
  isAudioClip,
}: ClipCoverageBadgesProps) {
  if (!enabled) return null;

  const transcriptBadge = clip.transcriptStatus === 'ready' && clip.transcript && clip.transcript.length > 0
    ? (() => {
        const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
        const mediaFile = mediaFileId ? mediaFiles.find(file => file.id === mediaFileId) : null;
        const pct = resolveTranscriptCoveragePercent({
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          duration: clip.duration,
          transcript: clip.transcript,
          transcribedRanges: mediaFile?.transcribedRanges,
        });
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-transcript-badge" title="Fully transcribed">T</div>
        ) : (
          <div className="clip-transcript-badge clip-badge-fill" title={`${pct}% transcribed`}>
            <span className="clip-badge-bg">T</span>
            <span className="clip-badge-progress clip-badge-transcript-fill" style={{ height: `${pct}%` }}>T</span>
          </div>
        );
      })()
    : null;

  const analysisBadge = !isAudioClip && (clip.analysisStatus === 'ready' || clip.sceneDescriptionStatus === 'ready')
    ? (() => {
        const pct = resolveAnalysisCoveragePercent({
          inPoint: clip.inPoint,
          outPoint: clip.outPoint,
          duration: clip.duration,
          frames: clip.analysis?.frames,
          sampleIntervalMs: clip.analysis?.sampleInterval,
        });
        if (pct <= 0) return null;
        return pct >= 100 ? (
          <div className="clip-analysis-badge" title="Fully analyzed">A</div>
        ) : (
          <div className="clip-analysis-badge clip-badge-fill" title={`${pct}% analyzed`}>
            <span className="clip-badge-bg">A</span>
            <span className="clip-badge-progress clip-badge-analysis-fill" style={{ height: `${pct}%` }}>A</span>
          </div>
        );
      })()
    : null;

  return (
    <>
      {transcriptBadge}
      {analysisBadge}
    </>
  );
});
