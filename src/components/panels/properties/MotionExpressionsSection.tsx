import { useCallback, useState } from 'react';

import { handleSetMotionExpressionForCurrentTimeline } from '../../../services/aiTools/handlers/motionDesign';
import { MOTION_MODIFIER_TARGET_PATHS, type MotionModifierTargetPath } from '../../../services/motionDesign/modifiers/contracts';
import { useTimelineStore } from '../../../stores/timeline';
import type { MotionExpressionBinding } from '../../../types/motionDesign';

interface MotionExpressionsSectionProps {
  clipId: string;
}

const EXPANDED_STORAGE_KEY = 'masterselects.motionExpressionsSection.expanded';

function readStoredExpanded(): boolean {
  try {
    return localStorage.getItem(EXPANDED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function persistExpanded(expanded: boolean): void {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, expanded ? '1' : '0');
  } catch { /* storage unavailable */ }
}

const styles = {
  header: {
    display: 'flex', alignItems: 'center', gap: '6px', width: '100%', margin: 0,
    padding: 0, border: 'none', background: 'none', color: 'inherit', font: 'inherit',
    textAlign: 'left', cursor: 'pointer',
  },
  chevron: {
    display: 'inline-block', width: '1em', color: 'var(--text-secondary)', fontSize: 'var(--font-xs)',
  },
  error: { margin: '4px 0', color: 'var(--color-error, #d33)', fontSize: 'var(--font-xs)' },
} as const;

export function MotionExpressionsSection({ clipId }: MotionExpressionsSectionProps) {
  const clip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [addPath, setAddPath] = useState<MotionModifierTargetPath | ''>('');
  const [addSource, setAddSource] = useState('');
  const [sourceDrafts, setSourceDrafts] = useState<Record<string, string>>({});
  const [fallbackDrafts, setFallbackDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const bindings = clip?.motion?.expressions?.bindings ?? [];
  const boundPaths = new Set(bindings.map(binding => binding.path));
  const availablePaths = MOTION_MODIFIER_TARGET_PATHS.filter(path => !boundPaths.has(path));

  const toggleExpanded = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      persistExpanded(next);
      return next;
    });
  }, []);

  const setBinding = useCallback(async (
    path: MotionModifierTargetPath,
    source: string,
    fallback: string | number,
    enabled: boolean,
  ) => {
    const result = await handleSetMotionExpressionForCurrentTimeline({
      clipId, operation: 'set', path, source, fallback: typeof fallback === 'string' ? Number(fallback) : fallback, enabled,
    });
    if (!result.success) {
      setErrors(current => ({ ...current, [path]: result.error ?? 'Could not set motion expression' }));
      return false;
    }
    setErrors(current => {
      const { [path]: _removed, ...rest } = current;
      return rest;
    });
    setSourceDrafts(current => {
      const { [path]: _removed, ...rest } = current;
      return rest;
    });
    setFallbackDrafts(current => {
      const { [path]: _removed, ...rest } = current;
      return rest;
    });
    return true;
  }, [clipId]);

  const removeBinding = useCallback(async (path: MotionModifierTargetPath) => {
    const result = await handleSetMotionExpressionForCurrentTimeline({ clipId, operation: 'remove', path });
    if (!result.success) {
      setErrors(current => ({ ...current, [path]: result.error ?? 'Could not remove motion expression' }));
      return;
    }
    setErrors(current => {
      const { [path]: _removed, ...rest } = current;
      return rest;
    });
  }, [clipId]);

  if (!clip?.motion?.shape) return null;

  return (
    <section className="properties-section" aria-label="Motion expressions">
      <h4>
        <button aria-expanded={expanded} style={styles.header} type="button" onClick={toggleExpanded}>
          <span aria-hidden="true" style={styles.chevron}>{expanded ? '▼' : '▶'}</span>
          Expressions
        </button>
      </h4>
      {expanded && <>
        {bindings.map((binding: MotionExpressionBinding) => {
          const source = sourceDrafts[binding.path] ?? binding.source;
          const fallback = fallbackDrafts[binding.path] ?? String(binding.fallback);
          return <div key={binding.path} className="properties-section">
            <div className="control-row">
              <label className="prop-label">{binding.path}</label>
              <input aria-label={`Expression source for ${binding.path}`} value={source} onChange={event => setSourceDrafts(current => ({ ...current, [binding.path]: event.target.value }))} />
              <button aria-label={`Set expression for ${binding.path}`} className="btn btn-xs" type="button" onClick={() => void setBinding(binding.path, source, fallback, binding.enabled)}>Set</button>
              <button aria-label={`Remove expression for ${binding.path}`} className="btn btn-xs" type="button" onClick={() => void removeBinding(binding.path)}>Remove</button>
            </div>
            <div className="control-row">
              <label>Fallback <input aria-label={`Expression fallback for ${binding.path}`} type="number" value={fallback} onChange={event => setFallbackDrafts(current => ({ ...current, [binding.path]: event.target.value }))} onBlur={() => void setBinding(binding.path, source, fallback, binding.enabled)} /></label>
              <label><input aria-label={`Enable expression for ${binding.path}`} type="checkbox" checked={binding.enabled} onChange={event => void setBinding(binding.path, source, fallback, event.target.checked)} /> Enabled</label>
            </div>
            {errors[binding.path] && <p role="alert" style={styles.error}>{errors[binding.path]}</p>}
          </div>;
        })}
        <div className="control-row motion-expression-add-row">
          <label className="prop-label motion-wide-label" htmlFor={`add-motion-expression-${clipId}`}>Add expression</label>
          <select id={`add-motion-expression-${clipId}`} aria-label="Expression path" value={addPath} onChange={event => setAddPath(event.target.value as MotionModifierTargetPath | '')}>
            <option value="">Choose path…</option>
            {availablePaths.map(path => <option key={path} value={path}>{path}</option>)}
          </select>
          <input aria-label="New expression source" value={addSource} onChange={event => setAddSource(event.target.value)} />
          <button aria-label="Set new expression" className="btn btn-xs" disabled={!addPath || !addSource.trim()} type="button" onClick={async () => {
            if (addPath && await setBinding(addPath, addSource, 0, true)) {
              setAddPath('');
              setAddSource('');
            }
          }}>Set</button>
        </div>
        {addPath && errors[addPath] && <p role="alert" style={styles.error}>{errors[addPath]}</p>}
      </>}
    </section>
  );
}
