import type { FlockDiagnostic } from '../../../../types/flock';
import type { TimelineClip } from '../../../../types/timeline';
import { compileFlockDefinitionCached } from '../../../../services/flock/compiler/flockCompiler';
import { getFlockNodeLabel } from './flockControlUtils';
import { useFlockRuntimeStatus } from './useFlockRuntimeStatus';

function DiagnosticItem({ diagnostic, nodeLabels }: { diagnostic: FlockDiagnostic; nodeLabels: string }) {
  return (
    <li className={`flock-diagnostic flock-diagnostic-${diagnostic.severity}`} data-flock-diagnostic={diagnostic.code}>
      <span className="flock-diagnostic-severity">{diagnostic.severity}</span>
      <span className="flock-diagnostic-message">{diagnostic.message}</span>
      {nodeLabels && <span className="flock-diagnostic-nodes">{nodeLabels}</span>}
    </li>
  );
}

/** Compile diagnostics (node-scoped) plus runtime diagnostics; invalid graphs get an explicit banner. */
export function FlockDiagnosticsSection({ clip }: { clip: TimelineClip }) {
  const status = useFlockRuntimeStatus(clip.id);
  const definition = clip.flock;
  if (!definition) return null;
  const result = compileFlockDefinitionCached(definition);

  const seen = new Set<string>();
  const merged = [...result.diagnostics, ...(status?.diagnostics ?? [])].filter((diagnostic) => {
    const key = `${diagnostic.severity}|${diagnostic.code}|${diagnostic.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const problems = merged.filter((diagnostic) => diagnostic.severity !== 'info');
  const infos = merged.filter((diagnostic) => diagnostic.severity === 'info');
  const labelsFor = (diagnostic: FlockDiagnostic) => (
    [...new Set((diagnostic.nodeIds ?? []).map((nodeId) => getFlockNodeLabel(definition, nodeId)))].join(', ')
  );

  return (
    <>
      {!result.ok && (
        <div className="flock-banner flock-banner-error" role="alert">
          Graph invalid — preview shows last valid result, export is blocked
        </div>
      )}
      {(problems.length > 0 || infos.length > 0) && (
        <div className="properties-section flock-diagnostics">
          <h4>Diagnostics</h4>
          {problems.length > 0 && (
            <ul className="flock-diagnostic-list">
              {problems.map((diagnostic, index) => (
                <DiagnosticItem key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} nodeLabels={labelsFor(diagnostic)} />
              ))}
            </ul>
          )}
          {infos.length > 0 && (
            <details className="flock-diagnostic-details">
              <summary>{infos.length} note{infos.length === 1 ? '' : 's'}</summary>
              <ul className="flock-diagnostic-list">
                {infos.map((diagnostic, index) => (
                  <DiagnosticItem key={`${diagnostic.code}-${index}`} diagnostic={diagnostic} nodeLabels={labelsFor(diagnostic)} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </>
  );
}
