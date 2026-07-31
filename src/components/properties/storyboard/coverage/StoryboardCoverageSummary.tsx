import type { StoryboardCoverage } from '../../../../services/storyboard/contracts';

export function StoryboardCoverageSummary({
  coverage,
  loading = false,
  error,
}: {
  readonly coverage: StoryboardCoverage | null;
  readonly loading?: boolean;
  readonly error?: string | null;
}) {
  if (loading) {
    return (
      <section className="storyboard-insights-section" aria-label="Scene coverage">
        <h4>Coverage</h4>
        <p role="status">Calculating source coverage and generation readiness…</p>
      </section>
    );
  }
  if (error || !coverage) {
    return (
      <section className="storyboard-insights-section" aria-label="Scene coverage">
        <h4>Coverage</h4>
        <p role="alert">{error || 'Coverage is unavailable.'}</p>
      </section>
    );
  }

  const levelLabel = coverage.level[0].toUpperCase() + coverage.level.slice(1);
  return (
    <section
      className={`storyboard-insights-section storyboard-coverage is-${coverage.level}`}
      aria-label="Scene coverage"
    >
      <div className="storyboard-insights-heading-row">
        <h4>Coverage</h4>
        <strong className="storyboard-coverage-level" aria-label={`${levelLabel} coverage`}>
          {levelLabel} coverage
        </strong>
      </div>
      <div className="storyboard-coverage-score">
        <label>
          <span>Existing source</span>
          <meter
            min="0"
            max="1"
            value={coverage.sourceScore}
            aria-label={`Existing source score: ${Math.round(coverage.sourceScore * 100)}%`}
          >
            {Math.round(coverage.sourceScore * 100)}%
          </meter>
          <output>{Math.round(coverage.sourceScore * 100)}%</output>
        </label>
        <label>
          <span>Generation readiness</span>
          <meter
            min="0"
            max="1"
            value={coverage.generationReadinessScore}
            aria-label={`Generation readiness score: ${Math.round(coverage.generationReadinessScore * 100)}%`}
          >
            {Math.round(coverage.generationReadinessScore * 100)}%
          </meter>
          <output>{Math.round(coverage.generationReadinessScore * 100)}%</output>
        </label>
      </div>
      <ul className="storyboard-coverage-reasons" aria-label="Coverage reasons">
        {coverage.reasons.map(reason => <li key={reason}>{reason}</li>)}
      </ul>
      <small>
        Fingerprint {coverage.evaluatedAgainstFingerprint.value.slice(0, 12)} · Coverage is advisory.
      </small>
    </section>
  );
}
