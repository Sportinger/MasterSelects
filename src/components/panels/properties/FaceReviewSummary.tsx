import { useMemo } from 'react';
import type { FrameAnalysisData } from '../../../types';
import { collectFaceReviewCandidates } from '../../../services/faceAnalysis/faceReviewCandidates';
import { FaceCropThumbnail } from './FaceCropThumbnail';
import { writeFaceDrag } from './faceDragPayload';

interface FaceReviewSummaryProps {
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
  frames,
  sourceFile,
  onSelectSourceTime,
}: FaceReviewSummaryProps) {
  const candidates = useMemo(() => collectFaceReviewCandidates(frames), [frames]);
  if (candidates.length === 0) return null;

  return (
    <div className="properties-section">
      <h4>Needs review ({candidates.length})</h4>
      <div style={{ color: 'var(--text-muted)', fontSize: '10px', marginBottom: '7px', marginTop: '-3px' }}>
        Small or brief yellow detections are grouped into short visual tracks. Drag one onto a person to assign it.
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '7px' }}>
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
            style={{
              appearance: 'none',
              background: 'transparent',
              border: 0,
              cursor: 'grab',
              height: '86px',
              padding: 0,
              position: 'relative',
              width: '86px',
            }}
          >
            <FaceCropThumbnail
              file={sourceFile}
              sample={candidate.sample}
              size={86}
              alt={`Review face ${index + 1} at ${formatTimestamp(candidate.sample.timestamp)}`}
            />
            <span style={{
              background: 'linear-gradient(180deg, rgba(0,0,0,.58), rgba(0,0,0,.06) 45%, rgba(0,0,0,.78))',
              border: '1px solid #f6bd60',
              borderRadius: '4px',
              color: 'white',
              display: 'flex',
              flexDirection: 'column',
              fontSize: '9px',
              inset: 0,
              justifyContent: 'space-between',
              padding: '5px',
              position: 'absolute',
              textAlign: 'left',
            }}>
              <span style={{ fontSize: '10px', fontWeight: 700 }}>Review {index + 1}</span>
              <span>
                {formatTimestamp(candidate.firstSeen)}
                {candidate.observationCount > 1 ? ` · ${candidate.observationCount} frames` : ''}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
