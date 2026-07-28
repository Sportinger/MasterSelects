import { IconUsers } from '@tabler/icons-react';
import type { FaceReviewCandidate } from '../../../services/faceAnalysis/faceReviewCandidates';
import type { FacePersonSummary, FrameAnalysisData } from '../../../types/clipMetadata';
import { FacePeopleSummary } from './FacePeopleSummary';
import { FaceReviewSummary } from './FaceReviewSummary';

interface AnalysisPeopleSettingsProps {
  candidates: readonly FaceReviewCandidate[];
  frames: readonly FrameAnalysisData[];
  people: readonly FacePersonSummary[];
  sourceFile?: File;
  onAssignReviewFaces: (candidateId: string, faceIds: string[], targetPersonId: string) => void;
  onMergePeople: (sourcePersonId: string, targetPersonId: string) => void;
  onMoveAppearance: (sourcePersonId: string, targetPersonId: string, sourceTime: number) => void;
  onSelectSourceTime: (sourceTime: number) => void;
}

export function AnalysisPeopleSettings({
  candidates,
  frames,
  people,
  sourceFile,
  onAssignReviewFaces,
  onMergePeople,
  onMoveAppearance,
  onSelectSourceTime,
}: AnalysisPeopleSettingsProps) {
  if (people.length === 0 && candidates.length === 0) return null;

  return (
    <section className="analysis-settings-area analysis-settings-area--people" aria-label="People adjustments">
      <h5 className="analysis-settings-area__title">
        <IconUsers aria-hidden="true" size={14} stroke={1.9} />
        <span>People</span>
      </h5>
      {people.length > 0 && (
        <FacePeopleSummary
          people={people}
          frames={frames}
          sourceFile={sourceFile}
          onSelectSourceTime={onSelectSourceTime}
          onMergePeople={onMergePeople}
          onMoveAppearance={onMoveAppearance}
          onAssignReviewFaces={onAssignReviewFaces}
        />
      )}
      {candidates.length > 0 && (
        <FaceReviewSummary
          candidates={candidates}
          frames={frames}
          sourceFile={sourceFile}
          onSelectSourceTime={onSelectSourceTime}
        />
      )}
    </section>
  );
}
