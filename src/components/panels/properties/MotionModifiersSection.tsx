import { useCallback, useState } from 'react';

import {
  MOTION_MODIFIER_CONTRACT_ID,
  MOTION_MODIFIER_CONTRACT_VERSION,
  MOTION_MODIFIER_TARGET_PATHS,
  parseMotionModifierStackContract,
  type MotionModifier,
  type MotionModifierFalloff,
  type MotionModifierStackContractV1,
} from '../../../services/motionDesign/modifiers/contracts';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { MotionLayerDefinition } from '../../../types/motionDesign';
import { DraggableNumber } from './shared';

interface MotionModifiersSectionProps {
  clipId: string;
  motion: MotionLayerDefinition;
}

type ModifierKind = MotionModifier['kind'];

const EXPANDED_STORAGE_KEY = 'masterselects.motionModifiersSection.expanded';

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
} as const;

const KIND_LABELS: Record<ModifierKind, string> = {
  random: 'Random',
  noise: 'Noise',
  oscillator: 'Oscillator',
  field: 'Field',
};

function defaultTarget() {
  return { path: 'replicator.offset.position.x' as const, operation: 'add' as const, amount: 50 };
}

function createModifier(kind: ModifierKind, order: number): MotionModifier {
  const common = {
    id: `modifier_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    order,
    enabled: true,
    targets: [defaultTarget()],
  };
  switch (kind) {
    case 'random': return { ...common, kind, seed: 1, distribution: 'uniform-signed' };
    case 'noise': return {
      ...common, kind, seed: 1, indexFrequency: 1, timeFrequencyHz: 1,
      octaves: 1, lacunarity: 2, persistence: 0.5,
    };
    case 'oscillator': return {
      ...common, kind, waveform: 'sine', frequencyHz: 1, cyclesAcrossInstances: 1, phaseDegrees: 0,
    };
    case 'field': return {
      ...common, kind, field: 'radial-distance', center: { x: 0, y: 0 }, radius: 200, exponent: 1,
    };
  }
}

function renumber(modifiers: MotionModifier[]): MotionModifier[] {
  return modifiers.map((modifier, order) => ({ ...modifier, order }));
}

function NumericRow({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <div className="labeled-value">
      <span className="labeled-value-label">{label}</span>
      <DraggableNumber
        value={value}
        onChange={onChange}
        decimals={2}
        onDragStart={() => startBatch(`Adjust modifier ${label}`)}
        onDragEnd={() => endBatch()}
      />
    </div>
  );
}

export function MotionModifiersSection({ clipId, motion }: MotionModifiersSectionProps) {
  const clips = useTimelineStore((state) => state.clips);
  const updateMotionLayer = useTimelineStore((state) => state.updateMotionLayer);
  const [expanded, setExpanded] = useState(readStoredExpanded);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [diagnostic, setDiagnostic] = useState<string | null>(null);
  const stack = motion.modifierStack;
  const modifiers = stack?.modifiers ?? [];
  const falloffCandidates = clips.filter((candidate) => (
    candidate.id !== clipId && candidate.motion?.kind === 'shape' && candidate.motion.shape
  ));

  const apply = useCallback((
    nextModifiers: MotionModifier[],
    // undefined (omitted) keeps the current falloff; null clears it.
    falloff: MotionModifierFalloff | null | undefined = stack?.falloff,
  ) => {
    if (nextModifiers.length === 0) {
      setDiagnostic(null);
      updateMotionLayer(clipId, (current) => ({
        ...current,
        modifierStack: undefined,
      }));
      return;
    }
    const candidate: MotionModifierStackContractV1 = {
      contract: MOTION_MODIFIER_CONTRACT_ID,
      version: MOTION_MODIFIER_CONTRACT_VERSION,
      revision: (stack?.revision ?? 0) + 1,
      timeBasis: 'clip-local-seconds',
      ticksPerSecond: 60,
      modifiers: renumber(nextModifiers),
      ...(falloff ? { falloff } : {}),
    };
    try {
      const parsed = parseMotionModifierStackContract(candidate);
      setDiagnostic(null);
      updateMotionLayer(clipId, (current) => ({ ...current, modifierStack: parsed }));
    } catch (error) {
      setDiagnostic(error instanceof Error ? error.message : String(error));
    }
  }, [clipId, stack, updateMotionLayer]);

  const patchModifier = (index: number, patch: Partial<MotionModifier>) => {
    apply(modifiers.map((modifier, modifierIndex) => (
      modifierIndex === index ? { ...modifier, ...patch } as MotionModifier : modifier
    )));
  };

  const setFalloff = (enabled: boolean) => {
    if (!enabled) {
      // null, not undefined: an explicit undefined would re-trigger apply's
      // default parameter (stack?.falloff) and the falloff would never clear.
      apply(modifiers, null);
      return;
    }
    const candidate = falloffCandidates[0];
    if (!candidate) {
      setDiagnostic('Add another motion-shape clip to use it as a falloff reference.');
      return;
    }
    apply(modifiers, {
      shapeClipId: candidate.id,
      shapeRevision: candidate.motion?.replicator?.revision ?? 0,
      feather: 0,
      invert: false,
      clip: false,
    });
  };

  const toggleExpanded = useCallback(() => {
    setExpanded(current => {
      const next = !current;
      persistExpanded(next);
      return next;
    });
  }, []);

  if (motion.kind !== 'shape') return null;

  return (
    <div className="properties-section" data-testid="motion-modifiers-section">
      <h4>
        <button aria-expanded={expanded} style={styles.header} type="button" onClick={toggleExpanded}>
          <span aria-hidden="true" style={styles.chevron}>{expanded ? '▼' : '▶'}</span>
          Modifiers
        </button>
      </h4>
      {expanded && <>
      {!motion.replicator?.enabled && (
        <p className="property-hint">Modifiers apply to replicator instances. Enable Replicator to see their effect.</p>
      )}
      <div className="control-row">
        <label className="prop-label motion-wide-label" htmlFor={`add-motion-modifier-${clipId}`}>Add modifier</label>
        <select
          id={`add-motion-modifier-${clipId}`}
          aria-label="Add modifier"
          value=""
          onChange={(event) => {
            const kind = event.target.value as ModifierKind;
            if (!kind) return;
            apply([...modifiers, createModifier(kind, modifiers.length)]);
          }}
        >
          <option value="">Choose…</option>
          {(Object.keys(KIND_LABELS) as ModifierKind[]).map((kind) => <option key={kind} value={kind}>{KIND_LABELS[kind]}</option>)}
        </select>
      </div>
      {modifiers.map((modifier, index) => (
        <div className="properties-section" key={modifier.id} data-testid={`motion-modifier-${modifier.id}`}>
          <div className="control-row">
            <button type="button" aria-label={`Expand ${KIND_LABELS[modifier.kind]} modifier`} onClick={() => setExpandedId(expandedId === modifier.id ? null : modifier.id)}>
              {expandedId === modifier.id ? '▾' : '▸'} {KIND_LABELS[modifier.kind]}
            </button>
            <label>
              <input type="checkbox" aria-label={`Enable ${KIND_LABELS[modifier.kind]} modifier`} checked={modifier.enabled} onChange={(event) => patchModifier(index, { enabled: event.target.checked })} />
              Enabled
            </label>
            <button type="button" aria-label={`Move ${KIND_LABELS[modifier.kind]} modifier up`} disabled={index === 0} onClick={() => {
              const next = [...modifiers]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; apply(next);
            }}>↑</button>
            <button type="button" aria-label={`Move ${KIND_LABELS[modifier.kind]} modifier down`} disabled={index === modifiers.length - 1} onClick={() => {
              const next = [...modifiers]; [next[index], next[index + 1]] = [next[index + 1], next[index]]; apply(next);
            }}>↓</button>
            <button type="button" aria-label={`Remove ${KIND_LABELS[modifier.kind]} modifier`} onClick={() => apply(modifiers.filter((_, modifierIndex) => modifierIndex !== index))}>Remove</button>
          </div>
          {expandedId === modifier.id && (
            <div>
              {modifier.kind === 'random' && <NumericRow label="Seed" value={modifier.seed} onChange={(seed) => patchModifier(index, { seed })} />}
              {modifier.kind === 'noise' && <>
                <NumericRow label="Seed" value={modifier.seed} onChange={(seed) => patchModifier(index, { seed })} />
                <NumericRow label="Index frequency" value={modifier.indexFrequency} onChange={(indexFrequency) => patchModifier(index, { indexFrequency })} />
                <NumericRow label="Time frequency" value={modifier.timeFrequencyHz} onChange={(timeFrequencyHz) => patchModifier(index, { timeFrequencyHz })} />
                <NumericRow label="Octaves" value={modifier.octaves} onChange={(octaves) => patchModifier(index, { octaves })} />
                <NumericRow label="Lacunarity" value={modifier.lacunarity} onChange={(lacunarity) => patchModifier(index, { lacunarity })} />
                <NumericRow label="Persistence" value={modifier.persistence} onChange={(persistence) => patchModifier(index, { persistence })} />
              </>}
              {modifier.kind === 'oscillator' && <>
                <div className="control-row"><label className="prop-label">Waveform</label><select aria-label="Oscillator waveform" value={modifier.waveform} onChange={(event) => patchModifier(index, { waveform: event.target.value as 'sine' | 'triangle' | 'square' })}><option value="sine">Sine</option><option value="triangle">Triangle</option><option value="square">Square</option></select></div>
                <NumericRow label="Frequency" value={modifier.frequencyHz} onChange={(frequencyHz) => patchModifier(index, { frequencyHz })} />
                <NumericRow label="Cycles across instances" value={modifier.cyclesAcrossInstances} onChange={(cyclesAcrossInstances) => patchModifier(index, { cyclesAcrossInstances })} />
                <NumericRow label="Phase" value={modifier.phaseDegrees} onChange={(phaseDegrees) => patchModifier(index, { phaseDegrees })} />
              </>}
              {modifier.kind === 'field' && <>
                <NumericRow label="Center X" value={modifier.center.x} onChange={(x) => patchModifier(index, { center: { ...modifier.center, x } })} />
                <NumericRow label="Center Y" value={modifier.center.y} onChange={(y) => patchModifier(index, { center: { ...modifier.center, y } })} />
                <NumericRow label="Radius" value={modifier.radius} onChange={(radius) => patchModifier(index, { radius })} />
                <NumericRow label="Exponent" value={modifier.exponent} onChange={(exponent) => patchModifier(index, { exponent })} />
              </>}
              <div className="section-header">Targets</div>
              {modifier.targets.map((target, targetIndex) => <div className="control-row" key={`${modifier.id}-${target.path}`}>
                <select aria-label={`${KIND_LABELS[modifier.kind]} target path`} value={target.path} onChange={(event) => patchModifier(index, { targets: modifier.targets.map((item, itemIndex) => itemIndex === targetIndex ? { ...item, path: event.target.value as typeof item.path } : item) })}>{MOTION_MODIFIER_TARGET_PATHS.map((path) => <option key={path} value={path}>{path}</option>)}</select>
                <select aria-label={`${KIND_LABELS[modifier.kind]} target operation`} value={target.operation} onChange={(event) => patchModifier(index, { targets: modifier.targets.map((item, itemIndex) => itemIndex === targetIndex ? { ...item, operation: event.target.value as 'add' | 'multiply' } : item) })}><option value="add">Add</option><option value="multiply">Multiply</option></select>
                <NumericRow label="Amount" value={target.amount} onChange={(amount) => patchModifier(index, { targets: modifier.targets.map((item, itemIndex) => itemIndex === targetIndex ? { ...item, amount } : item) })} />
              </div>)}
            </div>
          )}
        </div>
      ))}
      {stack && <div className="properties-section">
        <div className="section-header">Falloff</div>
        <label><input type="checkbox" aria-label="Enable falloff" checked={Boolean(stack.falloff)} onChange={(event) => setFalloff(event.target.checked)} /> Enable falloff</label>
        {stack.falloff && <>
          <div className="control-row"><label className="prop-label">Shape</label><select aria-label="Falloff shape" value={stack.falloff.shapeClipId} onChange={(event) => {
            const candidate = falloffCandidates.find((item) => item.id === event.target.value);
            if (candidate) apply(modifiers, { ...stack.falloff!, shapeClipId: candidate.id, shapeRevision: candidate.motion?.replicator?.revision ?? 0 });
          }}>{falloffCandidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}</select></div>
          <NumericRow label="Feather" value={stack.falloff.feather} onChange={(feather) => apply(modifiers, { ...stack.falloff!, feather })} />
          <label><input type="checkbox" aria-label="Invert falloff" checked={stack.falloff.invert} onChange={(event) => apply(modifiers, { ...stack.falloff!, invert: event.target.checked })} /> Invert</label>
          <label><input type="checkbox" aria-label="Clip falloff" checked={stack.falloff.clip} onChange={(event) => apply(modifiers, { ...stack.falloff!, clip: event.target.checked })} /> Clip</label>
        </>}
      </div>}
      {diagnostic && <div className="analysis-status error" role="status" data-testid="motion-modifier-diagnostic">{diagnostic}</div>}
      </>}
    </div>
  );
}
