import { useMemo } from 'react';
import type { FrameAnalysisData } from '../../../types/clipMetadata';
import {
  collectFaceReviewCandidates,
  type FaceReviewCandidate,
} from '../../../services/faceAnalysis/faceReviewCandidates';
import { FaceCropThumbnail } from './FaceCropThumbnail';
import { writeFaceDrag } from './faceDragPayload';
import './FacePeopleSummary.css';

interface FaceReviewSummaryProps {
  candidates?: readonly FaceReviewCandidate[];
  frames: readonly FrameAnalysisData[];
  sourceFile?: File;
  onSelectSourceTime: (sourceTime: number) => void;
}

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function FaceReviewSummary({
  candidates: providedCandidates,
  frames,
  sourceFile,
  onSelectSourceTime,
}: FaceReviewSummaryProps) {
  const candidates = useMemo(
    () => providedCandidates ?? collectFaceReviewCandidates(frames),
    [frames, providedCandidates],
  );
  if (candidates.length === 0) return null;

  return (
    <section className="FaceReviewSummary" aria-label="Faces needing review">
      <header className="FaceReviewSummary__header">
        <h4>Needs review ({candidates.length})</h4>
        <span>Drag a detection onto a person to assign it.</span>
      </header>
      <div className="FaceReviewSummary__grid">
        {candidates.map((candidate, index) => (
          <button
            key={candidate.id}
            type="button"
            draggable
            onDragStart={(event) => writeFaceDrag(event, {
              kind: 'review',
              candidateId: candidate.id,
              faceIds: candidate.faceIds,
              sample: candidate.sample,
            })}
            onClick={() => onSelectSourceTime(candidate.sample.timestamp)}
            title={`Review face ${index + 1} at ${formatTimestamp(candidate.sample.timestamp)}. Drag onto a person to assign.`}
            className="FaceReviewSummary__face"
          >
            <FaceCropThumbnail
              file={sourceFile}
              sample={candidate.sample}
              size={86}
              alt={`Review face ${index + 1} at ${formatTimestamp(candidate.sample.timestamp)}`}
            />
            <span className="FaceReviewSummary__meta">
              <strong>Review {index + 1}</strong>
              <span>
                {formatTimestamp(candidate.firstSeen)}
                {candidate.observationCount > 1 ? ` · ${candidate.observationCount} frames` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
