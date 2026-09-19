import { useMemo } from 'react';
import { compileFlockDefinitionCached } from '../../../../services/flock/compiler/flockCompiler';
import type { TimelineClip } from '../../../../stores/timeline/types';
import { FLOCK_RUNTIME_STATE_LABELS, useFlockRuntimeStatus } from './useFlockRuntimeStatus';
import type { FlockUiMessage } from './useFlockGraphActions';

function formatCount(value: number): string {
  return value >= 10_000 ? `${Math.round(value / 1000)}k` : String(value);
}

/** Compile + runtime state for the Flock view, plus transient action feedback. */
export function FlockGraphStatusBar({
  clip,
  message,
  onDismissMessage,
}: {
  clip: TimelineClip;
  message: FlockUiMessage | null;
  onDismissMessage: () => void;
}) {
  const status = useFlockRuntimeStatus(clip.id);
  const compile = useMemo(() => (clip.flock ? compileFlockDefinitionCached(clip.flock) : null), [clip.flock]);
  const errors = compile?.diagnostics.filter((diagnostic) => diagnostic.severity === 'error') ?? [];
  const warnings = compile?.diagnostics.filter((diagnostic) => diagnostic.severity === 'warning') ?? [];
  const state = status?.state ?? (compile && !compile.ok ? 'invalid' : 'idle');
  const stateLabel = status ? FLOCK_RUNTIME_STATE_LABELS[status.state] : compile && !compile.ok ? 'Invalid graph' : 'Not rendered yet';

  return (
    <div className="node-workspace-flock-status" role="status" aria-live="polite">
      <span className={`node-workspace-flock-state state-${state}`} title={status?.message}>{stateLabel}</span>
      {compile?.program && (
        <span className="node-workspace-flock-status-detail">
          {formatCount(compile.program.capacity)} particles · {compile.program.stepRate} Hz
          {status && status.state === 'computing' ? ` · step ${status.step}/${status.targetStep}` : ''}
        </span>
      )}
      {errors.length > 0 && (
        <span className="node-workspace-flock-status-errors" title={errors.map((diagnostic) => diagnostic.message).join('\n')}>
          {errors.length} error{errors.length === 1 ? '' : 's'}: {errors[0].message}
        </span>
      )}
      {errors.length === 0 && warnings.length > 0 && (
        <span className="node-workspace-flock-status-warnings" title={warnings.map((diagnostic) => diagnostic.message).join('\n')}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </span>
      )}
      {message && (
        <span className={`node-workspace-flock-message tone-${message.tone}`}>
          {message.text}
          <button type="button" aria-label="Dismiss message" onClick={(event) => {
            if (event.detail > 0) event.currentTarget.blur();
            onDismissMessage();
          }}>
            ×
          </button>
        </span>
      )}
    </div>
  );
}
