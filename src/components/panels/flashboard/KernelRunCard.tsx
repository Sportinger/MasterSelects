import { useCallback, useMemo, useRef, useState } from 'react';
import { undo as undoHistory } from '../../../stores/historyStore';
import {
  describeVerifiedDetails,
  shortFingerprint,
  type KernelReportStep,
  type KernelRunReport,
} from '../../../services/kernelClient/runReport';
import type { KernelProgressEvent } from '../../../services/kernelClient/runProgress';

interface KernelRunCardProps {
  /** Enables "Undo", which only makes sense for the newest run. */
  isLatest: boolean;
  report: KernelRunReport;
}

interface GroupedStep {
  capability?: string;
  count: number;
  durationMs: number;
  failed: boolean;
  tool: string;
}

/** Collapses runs of the same tool, so 24 cuts read as one line. */
function groupSteps(steps: KernelReportStep[]): GroupedStep[] {
  const groups: GroupedStep[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.tool === step.tool && last.failed === (step.status === 'failed')) {
      last.count += 1;
      last.durationMs += step.durationMs ?? 0;
      continue;
    }
    groups.push({
      ...(step.capability === undefined ? {} : { capability: step.capability }),
      count: 1,
      durationMs: step.durationMs ?? 0,
      failed: step.status === 'failed',
      tool: step.tool,
    });
  }
  return groups;
}

function formatSeconds(ms: number | undefined): string | undefined {
  if (ms === undefined || !Number.isFinite(ms)) return undefined;
  if (ms < 950) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatGoal(property: string, operation: string): string {
  return `${operation} · ${property}`;
}

const OUTCOME_LABEL: Record<KernelRunReport['outcome'], string> = {
  verified: 'Verified',
  declined: 'Not run',
  failed: 'Failed',
};

export function KernelRunCard({ isLatest, report }: KernelRunCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [undone, setUndone] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // The chat viewport is short because the bubble is capped by the preview
  // panel it floats in. Expanding would otherwise push the detail out of
  // sight, so the card pulls itself back into view.
  const toggleExpanded = useCallback(() => {
    setExpanded((value) => {
      const next = !value;
      if (next) {
        window.requestAnimationFrame(() => {
          cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return next;
    });
  }, []);

  const groups = useMemo(() => groupSteps(report.steps), [report.steps]);
  const digest = shortFingerprint(report.verified?.fingerprint);
  const total = formatSeconds(report.timings.totalMs);
  const understood = report.understood;
  const guesses = understood?.ambiguities ?? [];

  const headline = report.outcome === 'verified' && report.verified
    ? describeVerifiedDetails(report.verified)
    : report.outcome === 'declined'
      ? report.decline?.explanation ?? 'The kernel stopped before changing anything.'
      : report.failure ?? 'The run failed and was rolled back.';

  const hasDetails = report.outcome !== 'declined'
    ? Boolean(understood || groups.length > 0 || report.verified)
    : Boolean(report.decline?.detail || understood);

  const copyFingerprint = useCallback(() => {
    const fingerprint = report.verified?.fingerprint;
    if (!fingerprint || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(fingerprint).then(() => {
      setCopiedFingerprint(true);
      window.setTimeout(() => setCopiedFingerprint(false), 1100);
    }).catch(() => undefined);
  }, [report.verified?.fingerprint]);

  const handleUndo = useCallback(() => {
    undoHistory();
    setUndone(true);
  }, []);

  return (
    <div className={`fb-kernel-card is-${report.outcome}`} ref={cardRef}>
      <div className="fb-kernel-card-head">
        <span className="fb-kernel-card-status">{OUTCOME_LABEL[report.outcome]}</span>
        <div className="fb-kernel-card-meta">
          {report.steps.length > 0 && (
            <span>{report.steps.length} {report.steps.length === 1 ? 'step' : 'steps'}</span>
          )}
          {total && <span>{total}</span>}
          {report.mode && <span className="fb-kernel-card-mode">{report.mode}</span>}
        </div>
      </div>

      <p className="fb-kernel-card-headline">{headline}</p>

      {report.outcome === 'declined' && report.decline?.nextStep && (
        <p className="fb-kernel-card-next">{report.decline.nextStep}</p>
      )}

      {guesses.length > 0 && (
        <ul className="fb-kernel-card-guesses">
          {guesses.map((guess) => (
            <li key={guess.description}>
              <span className="fb-kernel-card-guess-mark">Assumed</span>
              <span>
                {guess.description}
                {guess.chosen ? ` → ${guess.chosen}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}

      {report.assumptionNote && (
        <p className="fb-kernel-card-note">{report.assumptionNote}</p>
      )}

      <div className="fb-kernel-card-actions">
        {hasDetails && (
          <button
            type="button"
            className="fb-kernel-card-action"
            onClick={toggleExpanded}
            aria-expanded={expanded}
          >
            {expanded ? 'Hide details' : 'Details'}
          </button>
        )}
        {digest && (
          <button
            type="button"
            className="fb-kernel-card-proof"
            onClick={copyFingerprint}
            title="Result fingerprint — click to copy the full digest"
          >
            {copiedFingerprint ? 'Copied' : digest}
          </button>
        )}
        {report.outcome === 'verified' && isLatest && (
          <button
            type="button"
            className="fb-kernel-card-action is-undo"
            onClick={handleUndo}
            disabled={undone}
          >
            {undone ? 'Undone' : 'Undo'}
          </button>
        )}
      </div>

      {expanded && (
        <div className="fb-kernel-card-details">
          {understood && (
            <section>
              <h4>Understood</h4>
              <dl>
                {understood.goals.map((goal) => (
                  <div key={`${goal.operation}-${goal.property}`}>
                    <dt>Goal</dt>
                    <dd>{formatGoal(goal.property, goal.operation)}</dd>
                  </div>
                ))}
                {understood.preserve.length > 0 && (
                  <div>
                    <dt>Preserve</dt>
                    <dd>{understood.preserve.join(', ')}</dd>
                  </div>
                )}
                {understood.assumptions.map((assumption) => (
                  <div key={assumption.name}>
                    <dt>Assumed</dt>
                    <dd>{assumption.name}: {JSON.stringify(assumption.value)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          {groups.length > 0 && (
            <section>
              <h4>Did</h4>
              <ul className="fb-kernel-card-steps">
                {groups.map((group, index) => (
                  <li key={`${group.tool}-${index}`} className={group.failed ? 'is-failed' : ''}>
                    <span className="fb-kernel-card-step-count">{group.count}×</span>
                    <span className="fb-kernel-card-step-tool">{group.tool}</span>
                    {group.capability && (
                      <span className="fb-kernel-card-step-capability">{group.capability}</span>
                    )}
                    {formatSeconds(group.durationMs) && (
                      <span className="fb-kernel-card-step-time">
                        {formatSeconds(group.durationMs)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.verified && (
            <section>
              <h4>Checked</h4>
              <ul className="fb-kernel-card-checks">
                <li className={report.verified.matches ? 'is-pass' : 'is-fail'}>
                  {report.verified.matches
                    ? 'Result matches the simulated plan'
                    : 'Result does not match the simulated plan'}
                </li>
                {report.verified.checks.map((check) => (
                  <li key={check.name} className={check.passed ? 'is-pass' : 'is-fail'}>
                    {check.name}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {report.decline?.detail && (
            <section>
              <h4>Kernel detail</h4>
              <p className="fb-kernel-card-detail">{report.decline.detail}</p>
            </section>
          )}

          {(report.timings.compileMs !== undefined
            || report.timings.executeMs !== undefined) && (
            <section>
              <h4>Timing</h4>
              <ul className="fb-kernel-card-timings">
                {report.timings.compileMs !== undefined && (
                  <li>Plan {formatSeconds(report.timings.compileMs)}</li>
                )}
                {report.timings.executeMs !== undefined && (
                  <li>Apply {formatSeconds(report.timings.executeMs)}</li>
                )}
                {report.timings.verifyMs !== undefined && (
                  <li>Verify {formatSeconds(report.timings.verifyMs)}</li>
                )}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

interface KernelRunProgressProps {
  progress: KernelProgressEvent;
}

/** Live stage rail shown while the kernel works the turn. */
export function KernelRunProgress({ progress }: KernelRunProgressProps) {
  const counter = progress.current !== undefined && progress.total !== undefined
    ? `${progress.current}/${progress.total}`
    : undefined;

  return (
    <div className="fb-kernel-progress">
      <span className="fb-kernel-progress-spinner" aria-hidden="true" />
      <span className="fb-kernel-progress-label">{progress.label}</span>
      {counter && <span className="fb-kernel-progress-count">{counter}</span>}
      {progress.detail && !counter && (
        <span className="fb-kernel-progress-detail">{progress.detail}</span>
      )}
    </div>
  );
}
