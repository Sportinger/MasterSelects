import type { StoryboardGenerationBrief } from '../../../../services/storyboard/contracts';
import type {
  StoryboardEvidenceResolution,
} from '../../../../services/storyboard/coverage';

export interface StoryboardEvidenceChipsProps {
  readonly evidence: readonly StoryboardEvidenceResolution[];
  readonly latestBrief?: StoryboardGenerationBrief;
  readonly onOpenEvidence?: (resolution: StoryboardEvidenceResolution) => void;
  readonly onRepairEvidence?: (resolution: StoryboardEvidenceResolution) => void;
}
function referenceRole(
  resolution: StoryboardEvidenceResolution,
  brief: StoryboardGenerationBrief | undefined,
): string {
  if (resolution.ref.kind !== 'reference-image' || !brief) return '';
  if (brief.startFrameMediaFileId === resolution.ref.mediaFileId) return 'Start frame';
  if (brief.endFrameMediaFileId === resolution.ref.mediaFileId) return 'End frame';
  return brief.referenceMediaFileIds.includes(resolution.ref.mediaFileId)
    ? 'Visual reference'
    : 'Reference';
}

function kindLabel(resolution: StoryboardEvidenceResolution): string {
  if (resolution.ref.kind === 'transcript-moment') return 'Transcript';
  if (resolution.ref.kind === 'source-range') return 'Source range';
  if (resolution.ref.kind === 'generated-candidate') return 'Candidate';
  return 'Reference image';
}

export function StoryboardEvidenceChips({
  evidence,
  latestBrief,
  onOpenEvidence,
  onRepairEvidence,
}: StoryboardEvidenceChipsProps) {
  return (
    <section className="storyboard-insights-section" aria-label="Scene evidence">
      <h4>Evidence</h4>
      {evidence.length === 0 ? (
        <p className="storyboard-insights-empty">No pinned evidence.</p>
      ) : (
        <ul className="storyboard-evidence-list">
          {evidence.map((resolution) => {
            const role = referenceRole(resolution, latestBrief);
            const statusText = resolution.status === 'current'
              ? 'Current'
              : resolution.status === 'repairable'
                ? 'Stale, verified repair available'
                : resolution.status === 'stale'
                  ? 'Stale, refresh required'
                  : resolution.status === 'missing'
                    ? 'Missing'
                    : 'Invalid';
            const canOpen = resolution.status === 'current' && (
              !!resolution.mediaFileId || !!resolution.candidateId
            );
            return (
              <li key={resolution.ref.id} className={`storyboard-evidence-chip is-${resolution.status}`}>
                <div className="storyboard-evidence-chip-copy">
                  <span className="storyboard-evidence-kind">
                    {kindLabel(resolution)}{role ? ` · ${role}` : ''}
                  </span>
                  <strong>{resolution.label}</strong>
                  <span>{resolution.detail}</span>
                  <span className="storyboard-evidence-status">{statusText}</span>
                  {resolution.moment?.facts?.map(fact => (
                    <span key={fact} className="storyboard-evidence-fact">Analysis fact: {fact}</span>
                  ))}
                </div>
                <div className="storyboard-evidence-actions">
                  {canOpen && (
                    <button
                      type="button"
                      onClick={() => onOpenEvidence?.(resolution)}
                      aria-label={`Open evidence ${resolution.label}`}
                    >
                      Open
                    </button>
                  )}
                  {(resolution.status === 'repairable' || resolution.status === 'stale') && (
                    <button
                      type="button"
                      onClick={() => onRepairEvidence?.(resolution)}
                      aria-label={`Repair evidence ${resolution.label}`}
                    >
                      {resolution.status === 'repairable' ? 'Repair reference' : 'Refresh to repair'}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
