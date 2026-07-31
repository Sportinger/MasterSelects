import { useState } from 'react';
import type { StoryboardDurationAssessment } from '../../../../services/storyboard/coverage';

export function StoryboardDurationBadge({
  assessment,
}: {
  readonly assessment: StoryboardDurationAssessment;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <section className="storyboard-insights-section" aria-label="Scene target and actual duration">
      <h4>Target / actual</h4>
      <button
        type="button"
        className={`storyboard-duration-badge is-${assessment.tone}`}
        aria-expanded={expanded}
        aria-label={assessment.accessibleLabel}
        onClick={() => setExpanded(current => !current)}
      >
        <strong>{assessment.badgeLabel}</strong>
        <span>{assessment.toneLabel}</span>
      </button>
      {expanded && (
        <div className="storyboard-duration-details">
          <p>
            The actual duration is the union of accepted filled clips inside this scene.
            Overlaps count once. Tolerance: ±{assessment.toleranceSeconds.toFixed(2)}s.
          </p>
          {assessment.unionSegments.length === 0 ? (
            <p>No valid filled-clip interval is inside the scene scope.</p>
          ) : (
            <ol aria-label="Actual duration union segments">
              {assessment.unionSegments.map(segment => (
                <li key={`${segment.startTime}:${segment.endTime}`}>
                  {segment.startTime.toFixed(2)}–{segment.endTime.toFixed(2)}s
                  {' · '}
                  {segment.clipIds.length} {segment.clipIds.length === 1 ? 'clip' : 'overlapping clips'}
                </li>
              ))}
            </ol>
          )}
          {assessment.constraint && (
            <p>
              Constraint {assessment.constraint.label || 'format'}:
              {' '}
              {assessment.constraint.minSeconds ?? 'no minimum'}–{assessment.constraint.maxSeconds ?? 'no maximum'}s.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
