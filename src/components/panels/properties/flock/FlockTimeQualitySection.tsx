import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { endBatch, startBatch } from '../../../../stores/historyStore';
import type { TimelineClip } from '../../../../types/timeline';
import type { FlockLoopMode } from '../../../../types/flock';
import { compileFlockDefinitionCached } from '../../../../services/flock/compiler/flockCompiler';
import { FLOCK_SIMULATION_OPERATOR_ID, getFlockParamDescriptor } from '../../../../services/flock/operators/flockOperatorRegistry';
import { flockRuntime, type FlockRuntimeState } from '../../../../engine/flock/runtime/flockRuntimeApi';
import { DraggableNumber } from '../shared';
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
        <button type="button" className="flock-button" onPointerUp={blurOnPointer} onClick={() => void flockRuntime.clearCache(clip.id).then(() => mounted.current && setMessage('Cache cleared'))}>
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

  return (
    <div className="properties-section flock-time-quality">
      <h4>Time &amp; Quality</h4>
      {simulation && (
        <>
          <div className="control-row">
            <label className="prop-label" htmlFor={`flock-step-rate-${clip.id}`}>Step rate</label>
            <select
              id={`flock-step-rate-${clip.id}`}
              value={stepRate}
              onChange={(event) => withBatch('Set flock step rate', () => setFlockGraphParam(clip.id, simulation.id, 'stepRate', event.target.value))}
            >
              {stepRateDescriptor?.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className="flock-control-hint">Resimulates from start</span>
          </div>
          <div className="control-row">
            <span className="prop-label">Warm-up</span>
            <DraggableNumber
              value={warmup}
              onChange={(value) => setFlockGraphParam(clip.id, simulation.id, 'warmup', Math.max(0, Math.min(30, value)))}
              min={0}
              max={30}
              decimals={1}
              sensitivity={0.05}
              suffix=" s"
              ariaLabel="Warm-up"
              onDragStart={() => startBatch('Set flock warm-up')}
              onDragEnd={() => endBatch()}
            />
          </div>
        </>
      )}
      <div className="control-row">
        <label className="prop-label" htmlFor={`flock-loop-${clip.id}`}>Loop</label>
        <select
          id={`flock-loop-${clip.id}`}
          value={definition.time.loop}
          onChange={(event) => withBatch('Set flock loop', () => setFlockTimeSettings(clip.id, { loop: event.target.value as FlockLoopMode }))}
        >
          <option value="none">Continuous</option>
          <option value="reset">Reset each loop</option>
        </select>
        {definition.time.loop === 'reset' && (
          <DraggableNumber
            value={definition.time.loopSeconds}
            onChange={(value) => setFlockTimeSettings(clip.id, { loopSeconds: Math.max(0.1, value) })}
            min={0.1}
            decimals={2}
            sensitivity={0.05}
            suffix=" s"
            ariaLabel="Loop length"
            onDragStart={() => startBatch('Set flock loop length')}
            onDragEnd={() => endBatch()}
          />
        )}
      </div>
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
    </div>
  );
}
