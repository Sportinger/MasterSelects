import { useEffect, useRef, useState, type ComponentProps } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import type { FlockLoopMode } from '../../../../types/flock';
import { compileFlockDefinitionCached } from '../../../../services/flock/compiler/flockCompiler';
import { FLOCK_SIMULATION_OPERATOR_ID, getFlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorRegistry';
import { flockRuntime, type FlockRuntimeState } from '../../../../engine/flock/runtime/flockRuntimeApi';
import { DraggableNumber } from '../shared';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { ResolveInspectorNumberRow } from '../resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorRow, ResolveInspectorSection } from '../resolveInspector/ResolveInspectorPrimitives';
import { formatFlockBytes } from './flockControlUtils';
import { useFlockRuntimeStatus } from './useFlockRuntimeStatus';

const STATE_LABELS: Record<FlockRuntimeState, string> = {
  idle: 'Idle',
  compiling: 'Compiling',
  computing: 'Computing',
  ready: 'Ready',
  stale: 'Stale',
  invalid: 'Invalid',
  'missing-asset': 'Missing asset',
  unsupported: 'Unsupported',
};

function blurOnPointer(event: React.PointerEvent<HTMLButtonElement>) {
  event.currentTarget.blur();
}

function withBatch(label: string, action: () => void) {
  startBatch(label);
  try {
    action();
  } finally {
    endBatch();
  }
}

function RuntimeStatusBlock({ clipId }: { clipId: string }) {
  const status = useFlockRuntimeStatus(clipId);
  const capabilities = flockRuntime.getCapabilities();
  const stateLabel = status ? STATE_LABELS[status.state] : 'Not rendered yet';

  return (
    <>
      <div className="control-row">
        <span className="prop-label">Status</span>
        <span className="flock-badge" data-state={status?.state ?? 'idle'}>{stateLabel}</span>
        {status?.message && <span className="flock-control-hint">{status.message}</span>}
      </div>
      <div className="control-row">
        <span className="prop-label">Host</span>
        <span className="flock-meta">
          {capabilities.gpuCompute
            ? 'GPU compute'
            : capabilities.fallback === 'cpu-limited'
              ? `CPU limited fallback (≤ ${capabilities.cpuFallbackMaxParticles.toLocaleString()} particles, export unavailable)`
              : 'No simulation host'}
        </span>
      </div>
      {status && (
        <>
          <div className="control-row">
            <span className="prop-label">Particles</span>
            <span className="flock-meta">
              {status.aliveCount.toLocaleString()} alive / {status.simulatedCount.toLocaleString()} simulated
              {status.requestedCount !== status.simulatedCount ? ` (requested ${status.requestedCount.toLocaleString()})` : ''}
            </span>
          </div>
          <div className="control-row">
            <span className="prop-label">Steps</span>
            <span className="flock-meta">
              {status.step.toLocaleString()} / {status.targetStep.toLocaleString()} @ {status.stepRate} Hz · t = {status.sourceTime.toFixed(2)} s
            </span>
          </div>
          <div className="control-row">
            <span className="prop-label">Neighbors</span>
            <span className="flock-meta">{status.neighborSaturatedCells.toLocaleString()} saturated cells · {formatFlockBytes(status.memoryBytes)} GPU</span>
          </div>
          {Object.keys(status.phaseTimingsMs).length > 0 && (
            <div className="flock-phase-timings" aria-label="Phase timings">
              {Object.entries(status.phaseTimingsMs).map(([phase, milliseconds]) => (
                <span key={phase} className="flock-phase-timing">{phase} {milliseconds.toFixed(1)} ms</span>
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

function PrecomputeBlock({ clip }: { clip: TimelineClip }) {
  const status = useFlockRuntimeStatus(clip.id);
  const setFlockCacheSettings = useTimelineStore((state) => state.setFlockCacheSettings);
  const cache = clip.flock?.cache;
  const [rangeStart, setRangeStart] = useState(cache?.precomputeEnd ? cache.precomputeStart : clip.inPoint);
  const [rangeEnd, setRangeEnd] = useState(cache?.precomputeEnd ? cache.precomputeEnd : clip.outPoint);
  const [persist, setPersist] = useState(cache?.persist ?? false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runPrecompute = async () => {
    const start = Math.max(0, Math.min(rangeStart, rangeEnd));
    const end = Math.max(rangeStart, rangeEnd);
    setFlockCacheSettings(clip.id, { precomputeStart: start, precomputeEnd: end, persist });
    setMessage(null);
    setBusy(true);
    try {
      const result = await flockRuntime.requestPrecompute(clip.id, { start, end }, { persist });
      if (mounted.current) {
        setMessage(result.ok
          ? `Precomputed ${start.toFixed(2)}–${end.toFixed(2)} s${result.steps ? ` (${result.steps.toLocaleString()} steps)` : ''}`
          : result.message ?? 'Precompute failed');
      }
    } catch (error) {
      if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const progress = status?.cache.precomputeProgress;
  return (
    <>
      <div className="control-row">
        <span className="prop-label">Range</span>
        <DraggableNumber value={rangeStart} onChange={(value) => setRangeStart(Math.max(0, value))} min={0} decimals={2} sensitivity={0.05} suffix=" s" ariaLabel="Precompute start" />
        <DraggableNumber value={rangeEnd} onChange={(value) => setRangeEnd(Math.max(0, value))} min={0} decimals={2} sensitivity={0.05} suffix=" s" ariaLabel="Precompute end" />
      </div>
      <div className="control-row">
        <label className="flock-checkbox">
          <input type="checkbox" checked={persist} onChange={(event) => setPersist(event.target.checked)} />
          Persist for reopen
        </label>
      </div>
      <div className="control-row flock-button-row">
        <button type="button" className="flock-button" disabled={busy} onPointerUp={blurOnPointer} onClick={() => void runPrecompute()}>
          {busy ? 'Precomputing…' : 'Precompute'}
        </button>
        <button type="button" className="flock-button" disabled={!busy && progress == null} onPointerUp={blurOnPointer} onClick={() => flockRuntime.cancelPrecompute(clip.id)}>
          Cancel
        </button>
        <button type="button" className="flock-button" onPointerUp={blurOnPointer} onClick={() => void flockRuntime.clearCache(clip.id)
          .then(() => mounted.current && setMessage('Cache cleared'))
          .catch(error => mounted.current && setMessage(error instanceof Error ? error.message : String(error)))}>
          Clear cache
        </button>
      </div>
      {progress != null && (
        <div className="control-row">
          <progress className="flock-progress" aria-label="Precompute progress" max={1} value={Math.max(0, Math.min(1, progress))} />
          <span className="flock-meta">{Math.round(Math.max(0, Math.min(1, progress)) * 100)}%</span>
        </div>
      )}
      {status && (
        <div className="control-row">
          <span className="prop-label">Cache</span>
          <span className="flock-meta" data-cache-current={status.cache.current ? 'true' : 'false'}>
            {status.cache.current ? 'Current' : 'Outdated — recompute needed'} · {status.cache.checkpointCount} checkpoints ({formatFlockBytes(status.cache.checkpointBytes)})
            {status.cache.coveredSourceRange ? ` · ${status.cache.coveredSourceRange[0].toFixed(2)}–${status.cache.coveredSourceRange[1].toFixed(2)} s` : ''}
            {status.cache.persistedCheckpointCount > 0 ? ` · ${status.cache.persistedCheckpointCount} persisted` : ''}
          </span>
        </div>
      )}
      {message && <p className="properties-hint" role="status">{message}</p>}
    </>
  );
}

/**
 * A number row that restarts the swarm (Warm-up, Loop length): a drag shows the value it would
 * set and commits once, on release, so the swarm is not resimulated on every drag step.
 */
function CommitOnReleaseNumberRow({ value, onCommitValue, ...row }: Omit<ComponentProps<typeof ResolveInspectorNumberRow>, 'onChange' | 'onDragStart' | 'onDragEnd'>
  & { onCommitValue: (value: number) => void }) {
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false), pending = useRef<number | null>(null);
  return <ResolveInspectorNumberRow {...row} value={draft ?? value}
    onDragStart={() => { dragging.current = true; }}
    onDragEnd={() => {
      dragging.current = false;
      const next = pending.current;
      pending.current = null; setDraft(null);
      if (next !== null && next !== value) onCommitValue(next);
    }}
    onChange={(next) => {
      if (dragging.current) { pending.current = next; setDraft(next); } else if (next !== value) onCommitValue(next);
    }} />;
}

/** Simulation clock, loop, memory, host capability, runtime status and precompute. */
export function FlockTimeQualitySection({ clip }: { clip: TimelineClip }) {
  const setFlockGraphParam = useTimelineStore((state) => state.setFlockGraphParam);
  const setFlockTimeSettings = useTimelineStore((state) => state.setFlockTimeSettings);
  const definition = clip.flock;
  if (!definition) return null;
  const compiled = compileFlockDefinitionCached(definition);
  const simulation = definition.nodes.find((node) => node.operator === FLOCK_SIMULATION_OPERATOR_ID);
  const stepRateDescriptor = getFlockParamDescriptor(FLOCK_SIMULATION_OPERATOR_ID, 'stepRate');
  const stepRate = String(simulation?.params.stepRate ?? stepRateDescriptor?.default ?? '60');
  const warmup = typeof simulation?.params.warmup === 'number' ? simulation.params.warmup : 0;

  const loopOptions: Array<{ value: FlockLoopMode; label: string }> = [
    { value: 'none', label: 'Continuous' },
    { value: 'reset', label: 'Reset each loop' },
  ];

  return (
    <div className="flock-time-quality">
      <ResolveInspectorSection title="Time & Quality">
        {simulation && (
          <>
            <ResolveInspectorRow label="Step rate" title="How often the swarm is simulated per second. Resimulates from the start.">
              <InspectorSelect
                ariaLabel="Step rate"
                value={stepRate}
                options={(stepRateDescriptor?.options ?? []).map((option) => ({ value: option.value, label: option.label }))}
                onChange={(next) => withBatch('Set flock step rate', () => setFlockGraphParam(clip.id, simulation.id, 'stepRate', next))}
              />
            </ResolveInspectorRow>
            <CommitOnReleaseNumberRow
              label="Warm-up"
              title="Seconds simulated before the clip starts, so the swarm is already formed on its first frame."
              value={warmup}
              defaultValue={0}
              min={0}
              max={30}
              step={0.1}
              decimals={1}
              sensitivity={0.05}
              suffix=" s"
              hardMin={0}
              hardMax={30}
              onCommitValue={(value) => withBatch('Set flock warm-up', () => setFlockGraphParam(clip.id, simulation.id, 'warmup', value))}
            />
          </>
        )}
        <ResolveInspectorRow label="Loop">
          <InspectorSelect
            ariaLabel="Loop"
            value={definition.time.loop}
            options={loopOptions}
            onChange={(next) => withBatch('Set flock loop', () => setFlockTimeSettings(clip.id, { loop: next }))}
          />
        </ResolveInspectorRow>
        {definition.time.loop === 'reset' && (
          <CommitOnReleaseNumberRow
            label="Loop length"
            value={definition.time.loopSeconds}
            defaultValue={10}
            min={0.1}
            max={Math.max(30, definition.time.loopSeconds)}
            step={0.1}
            decimals={2}
            sensitivity={0.05}
            suffix=" s"
            hardMin={0.1}
            numberMax={Number.POSITIVE_INFINITY}
            onCommitValue={(value) => withBatch('Set flock loop length', () => setFlockTimeSettings(clip.id, { loopSeconds: value }))}
          />
        )}
      </ResolveInspectorSection>
      <ResolveInspectorSection title="Simulation status" defaultOpen={false}>
        <div className="control-row">
          <span className="prop-label">Memory</span>
          <span className="flock-meta">
            {compiled.program
              ? `${compiled.program.capacity.toLocaleString()} capacity · est. ${formatFlockBytes(compiled.program.estimate.totalBytes)}`
              : 'Unavailable while the graph is invalid'}
          </span>
        </div>
        <RuntimeStatusBlock clipId={clip.id} />
        <PrecomputeBlock clip={clip} />
      </ResolveInspectorSection>
    </div>
  );
}
