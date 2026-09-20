import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { useState } from 'react';
import type { TimelineClip } from '../../../../types';
import { useTimelineStore } from '../../../../stores/timeline';
import { cableOperatorGraph } from '../../../../services/faceCables/cableOperatorGraph';
import { getEffectOperator, EFFECT_OPERATORS } from '../../../../services/operators/operatorRegistry';
import { SCENE_OPERATORS } from '../../../../services/operators/sceneOperators';
import { createEffectGraphActions, editEffectGraph } from '../../../../services/operators/effectGraphEditing';
import { sampleOperatorParameter, operatorEnabled } from '../../../../services/operators/effectGraph';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { PreciseFaceTrackingControls } from '../../properties/PreciseFaceTrackingControls';
import { TransformTab } from '../../properties/TransformTab';
import type { Keyframe } from '../../../../types/keyframes';
import { OperatorConnections } from './OperatorConnections';

const EMPTY_KEYS: Keyframe[] = [];
export function OperatorParameters({ clip, effectId, nodeId }: { clip: TimelineClip; effectId: string; nodeId: string }) {
  const [message, setMessage] = useState('');
  const time = useTimelineStore(s => s.playheadPosition - clip.startTime);
  const keys = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_KEYS);
  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) return null;
  let graph;
  try { graph = cableOperatorGraph(effect.params); } catch (error) { return <p role="alert">{String(error)}</p>; }
  const node = graph.nodes.find(n => n.id === nodeId), operator = node && getEffectOperator(node.operator);
  if (!node || !operator) return null;
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(String(error)); } };
  const set = (key: string, value: number | boolean) => safely(() => {
    const property = `effect.${effectId}.${key}` as Keyframe['property'];
    if (typeof value === 'number' && keys.some(k => k.property === property)) useTimelineStore.getState().addKeyframe(clip.id, property, value);
    else editEffectGraph(clip.id, effectId, 'Edit node parameter', (_, params) => { params[key] = value; });
  });
  const numberRow = (key: string, label: string, value: number, fallback: number, min = -30, max = 30, step = 0.01, animatable = true) =>
    <ResolveInspectorNumberRow key={key} label={label} ariaLabel={`${operator.label} ${label}`} value={value} defaultValue={fallback}
      min={min} max={max} step={step} onChange={v => set(key, v)} persistenceKey={`operator.${effectId}.${key}`}
      keyframeToggle={animatable ? <button type="button" className="keyframe-toggle" aria-label={`Keyframe ${operator.label} ${label}`}
        onClick={() => useTimelineStore.getState().addKeyframe(clip.id, `effect.${effectId}.${key}` as Keyframe['property'], value)}>◇</button> : undefined} />;
  return <div className="operator-parameters" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button,select,input[type="checkbox"]')?.blur();
  }}>
    <ResolveInspectorSection title={operator.label} enabled={operatorEnabled(node, effect.params)}
      onEnabledChange={operator.bypass ? () => safely(() => createEffectGraphActions(clip.id, effectId).toggleBypass(node.id)) : undefined}>
      {operator.parameters.map(spec => {
        const binding = node.bindings[spec.id];
        const value = sampleOperatorParameter(node, spec.id, effect.params, effectId, keys, time);
        if (typeof binding === 'object' && !Array.isArray(binding)) return <div key={spec.id}>
          {numberRow(binding.yaw, 'Direction', interpolateKeyframes(keys, `effect.${effectId}.${binding.yaw}` as Keyframe['property'], time, Number(effect.params[binding.yaw] ?? 0)), 0, -180, 180, 0.1)}
          {numberRow(binding.pitch, 'Elevation', interpolateKeyframes(keys, `effect.${effectId}.${binding.pitch}` as Keyframe['property'], time, Number(effect.params[binding.pitch] ?? 0)), 0, -90, 90, 0.1)}
        </div>;
        if (Array.isArray(binding) && Array.isArray(value)) return binding.map((key, i) => numberRow(key, `${spec.label} ${'XYZ'[i]}`, value[i], (spec.default as number[])[i], -1, 1));
        if (typeof binding !== 'string') return null;
        if (spec.type === 'boolean') return <ResolveInspectorRow key={spec.id} label={spec.label}><input aria-label={`${operator.label} ${spec.label}`} type="checkbox" checked={Boolean(value)} onChange={event => set(binding, event.target.checked)} /></ResolveInspectorRow>;
        return numberRow(binding, spec.label, Number(value), Number(spec.default), spec.min, spec.max, spec.step, spec.animatable);
      })}
      {!operator.parameters.length && <p className="face-cable-hint">{operator.description}</p>}
    </ResolveInspectorSection>
    <OperatorConnections graph={graph} node={node} clipId={clip.id} effectId={effectId} safely={safely} />
    {operator.id === 'scene.transform' && <TransformTab clipId={clip.id} transform={clip.transform} is3D={clip.is3D} speed={clip.speed} />}
    {operator.id === 'tracking.face' && <PreciseFaceTrackingControls clipId={clip.id} />}
    {operator.invalidates !== 'appearance' && <p className="face-cable-hint">Bake cables to apply changes to playback and export. Saved depth can be reused for physics.</p>}
    {message && <p role="alert">{message}</p>}
  </div>;
}

/** The effect form is another view of the same graph parameter bindings. */
export function AdditionalOperatorControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  if (!clip) return null;
  const effect = clip.effects.find(e => e.id === effectId); if (!effect) return null;
  let graph;
  try { graph = cableOperatorGraph(effect.params); } catch { return null; }
  return <>{graph.nodes.filter(n => n.id !== 'wind' && ((getEffectOperator(n.operator)?.addable && Boolean(getEffectOperator(n.operator)?.parameters.length) && n.id !== 'calibration') || ['tracking.smooth', 'geometry.merge-surface'].includes(n.operator)))
    .map(n => <OperatorParameters key={n.id} clip={clip} effectId={effectId} nodeId={n.id} />)}</>;
}

export function AddOperatorControl({ clipId, effectId, onAdded }: { clipId: string; effectId: string; onAdded?: (id: string) => void }) {
  const [message, setMessage] = useState('');
  return <><InspectorSelect ariaLabel="Add reusable node" value="" options={[{ value: '', label: 'Add node…' }, ...EFFECT_OPERATORS.filter(o => o.addable && !SCENE_OPERATORS.includes(o)).map(o => ({ value: o.id, label: o.label }))]}
    onChange={value => { if (!value) return; try { const id = createEffectGraphActions(clipId, effectId).addNode(value); setMessage(''); onAdded?.(id); } catch (error) { setMessage(String(error)); } }} />
    {message && <p role="alert">{message}</p>}</>;
}
