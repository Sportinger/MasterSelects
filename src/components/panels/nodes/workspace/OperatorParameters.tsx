import { readTimelineRuntimeState } from '../../../../services/timeline/timelineRuntimeCoordinator';
import { interpolateKeyframes } from '../../../../utils/keyframeInterpolation';
import { useState } from 'react';
import type { TimelineClip } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { effectOperatorGraph, effectOperatorParams, addableEffectOperators, isImageGraphEffectType } from '../../../../services/operators/effectGraphOwner';
import { VOXEL_RELIEF_PARAMS } from '../../../../effects/stylize/voxel-relief/parameters';
import { getEffectOperator } from '../../../../services/operators/operatorRegistry';
import { createEffectGraphActions, editEffectGraph, setOperatorConstant, setOperatorVariant } from '../../../../services/operators/effectGraphEditing';
import { sampleOperatorParameter, operatorEnabled } from '../../../../services/operators/effectGraph';
import { ResolveInspectorNumberRow } from '../../properties/resolveInspector/ResolveInspectorNumberRow';
import { ResolveInspectorSection, ResolveInspectorRow } from '../../properties/resolveInspector/ResolveInspectorPrimitives';
import { InspectorSelect } from '../../../inspector/InspectorSelect';
import { PreciseFaceTrackingControls } from '../../properties/PreciseFaceTrackingControls';
import { TransformTab } from '../../properties/TransformTab';
import type { Keyframe } from '../../../../types/keyframes';
import { OperatorConnections } from './OperatorConnections';
import { mathModeOptions, setMathNodeMode } from '../../../../services/nodeGraph/mathNodeEditing';
import type { NodeGraphNode } from '../../../../types/nodeGraph';
import { OperatorLiveValue } from './OperatorLiveValue';
import { operatorFamilyOptions } from './operatorFamilyOptions';
import { operatorConstantNumberPersistenceKey } from '../../../common/EditableDraggableNumberSettings';
import type { OperatorValue } from '../../../../types/operatorGraph';
import { getEffect } from '../../../../effects';
import { OperatorColorInput } from './OperatorColorInput';
import { resolveImageOperatorChoiceValue } from '../../../../services/operators/imageOperatorChoice';
import { GlyphAtlasControls } from './GlyphAtlasControls';

const EMPTY_KEYS: Keyframe[] = [];
export function OperatorParameters({ clip, effectId, nodeId, projectedNode }: { clip: TimelineClip; effectId: string; nodeId: string; projectedNode?: NodeGraphNode }) {
  const [message, setMessage] = useState('');
  const time = useTimelineStore(s => s.playheadPosition - clip.startTime);
  const keys = useTimelineStore(s => s.clipKeyframes.get(clip.id) ?? EMPTY_KEYS);
  const isRecording = useTimelineStore(s => s.isRecording);
  const effect = clip.effects.find(e => e.id === effectId);
  if (!effect) return null;
  let graph;
  try { graph = effectOperatorGraph(effect); } catch (error) { return <p role="alert">{String(error)}</p>; }
  const node = graph.nodes.find(n => n.id === nodeId), operator = node && getEffectOperator(node.operator);
  if (!node || !operator) return null;
  const evaluatedParams = effectOperatorParams(effect);
  const parameterSchema = isImageGraphEffectType(effect.type) || effect.type === 'analog-signal-lab' ? getEffect(effect.type)?.params : undefined;
  const familyOptions = operatorFamilyOptions(operator).filter(option => option.value === operator.id || addableEffectOperators(effect.type).some(operator => operator.id === option.value));
  const mathNode = { id: node.id, operatorId: node.operator, label: operator.label, kind: 'effect' as const, runtime: 'builtin' as const,
    inputs: [], outputs: [], layout: { x: 0, y: 0 }, binding: { kind: 'effect-operator' as const, effectId, nodeId: node.id, operator: node.operator } };
  const mathOptions = mathModeOptions(mathNode);
  const safely = (action: () => void) => { try { action(); setMessage(''); } catch (error) { setMessage(String(error)); } };
  const set = (key: string, value: OperatorValue) => safely(() => {
    const property = `effect.${effectId}.${key}` as Keyframe['property'];
    if (typeof value === 'number' && (isRecording(clip.id, property) || keys.some(k => k.property === property))) readTimelineRuntimeState(useTimelineStore).addKeyframe(clip.id, property, value);
    else editEffectGraph(clip.id, effectId, 'Edit node parameter', (_, params) => { params[key] = value; });
  });
  const numberRow = (key: string, label: string, value: number, fallback: number, min = -30, max = 30, step = 0.01, animatable = true) =>
    <ResolveInspectorNumberRow key={key} label={label} ariaLabel={`${operator.label} ${label}`} value={value} defaultValue={fallback}
      min={min} max={max} step={step} onChange={v => set(key, v)} persistenceKey={`operator.${effectId}.${key}`}
      keyframeToggle={animatable ? <button type="button" className="keyframe-toggle" aria-label={`Keyframe ${operator.label} ${label}`}
        onClick={() => readTimelineRuntimeState(useTimelineStore).addKeyframe(clip.id, `effect.${effectId}.${key}` as Keyframe['property'], value)}>◇</button> : undefined} />;
  return <div className="operator-parameters" onPointerUp={event => {
    if (event.target instanceof Element) event.target.closest<HTMLElement>('button,select,input[type="checkbox"]')?.blur();
  }}>
    <ResolveInspectorSection title={operator.label} enabled={operatorEnabled(node, effect.params)}
      onEnabledChange={graph.domain === 'voxel' || operator.bypass ? () => safely(() => createEffectGraphActions(clip.id, effectId).toggleBypass(node.id)) : undefined}>
      {mathOptions.length > 1 && <ResolveInspectorRow label="Operation">
        <InspectorSelect ariaLabel="Math operation" value={node.operator} options={mathOptions}
          onChange={mode => safely(() => setMathNodeMode(clip.id, mathNode, mode))} />
      </ResolveInspectorRow>}
      {familyOptions.length > 1 && <ResolveInspectorRow label={operator.family === 'values.numeric' ? 'Type' : operator.family === 'geometry.primitive' ? 'Shape' : 'Components'}>
        <InspectorSelect ariaLabel={operator.family === 'values.numeric' ? 'Value type' : operator.family === 'geometry.primitive' ? 'Primitive shape' : `${operator.family} components`} value={node.operator} options={familyOptions}
          onChange={variant => safely(() => setOperatorVariant(clip.id, effectId, node.id, variant))} />
      </ResolveInspectorRow>}
      {operator.id === 'glyph.atlas' && <GlyphAtlasControls bindings={node.bindings} params={evaluatedParams} parameterSchema={parameterSchema}
        onChange={set} renderNumber={(key, spec) => numberRow(key, spec.label,
          interpolateKeyframes(keys, `effect.${effectId}.${key}` as Keyframe['property'], time, Number(effect.params[key] ?? spec.default)),
          Number(spec.default), spec.min, spec.max, spec.step, spec.animatable)} />}
      {operator.parameters.map(spec => {
        if (projectedNode && node.operator.startsWith('math.') && graph.edges.some(edge => edge.to === node.id && edge.input === spec.id))
          return <OperatorLiveValue key={spec.id} clipId={clip.id} node={projectedNode} portId={spec.id} label={spec.label} />;
        const binding = node.bindings[spec.id];
        const value = sampleOperatorParameter(node, spec.id, evaluatedParams, effectId, keys, time);
        const constant = node.constants?.[spec.id];
        if (binding === undefined && constant !== undefined) {
          if (spec.type === 'boolean') return <ResolveInspectorRow key={spec.id} label={spec.label}><input aria-label={`${operator.label} ${spec.label}`} type="checkbox"
            checked={Boolean(constant)} onChange={event => safely(() => setOperatorConstant(clip.id, effectId, node.id, spec.id, event.target.checked))} /></ResolveInspectorRow>;
          if (spec.type === 'color') return <ResolveInspectorRow key={spec.id} label={spec.label}><OperatorColorInput ariaLabel={`${operator.label} ${spec.label}`}
            value={String(constant)} onChange={value => safely(() => setOperatorConstant(clip.id, effectId, node.id, spec.id, value))} /></ResolveInspectorRow>;
          if (spec.type === 'number') return <ResolveInspectorNumberRow key={spec.id} label={spec.label} ariaLabel={`${operator.label} ${spec.label}`}
            value={Number(constant)} defaultValue={Number(spec.default)}
            min={operator.family === 'values.numeric' ? Math.min(spec.min ?? -30, Number(constant)) : spec.min ?? -30}
            max={operator.family === 'values.numeric' ? Math.max(spec.max ?? 30, Number(constant)) : spec.max ?? 30} step={spec.step ?? 0.01}
            onChange={next => safely(() => setOperatorConstant(clip.id, effectId, node.id, spec.id, next))}
            persistenceKey={operatorConstantNumberPersistenceKey({ clipId: clip.id, effectId, nodeId: node.id, parameter: spec.id })} />;
          if (spec.type === 'select') return <ResolveInspectorRow key={spec.id} label={spec.label}><InspectorSelect ariaLabel={`${operator.label} ${spec.label}`}
            value={String(constant)} options={[...(spec.options ?? [])]}
            onChange={next => safely(() => setOperatorConstant(clip.id, effectId, node.id, spec.id, next))} /></ResolveInspectorRow>;
        }
        if (typeof binding === 'object' && !Array.isArray(binding)) return <div key={spec.id}>
          {numberRow(binding.yaw, 'Direction', interpolateKeyframes(keys, `effect.${effectId}.${binding.yaw}` as Keyframe['property'], time, Number(effect.params[binding.yaw] ?? 0)), 0, -180, 180, 0.1)}
          {numberRow(binding.pitch, 'Elevation', interpolateKeyframes(keys, `effect.${effectId}.${binding.pitch}` as Keyframe['property'], time, Number(effect.params[binding.pitch] ?? 0)), 0, -90, 90, 0.1)}
        </div>;
        if (Array.isArray(binding) && Array.isArray(value)) return binding.map((key, i) => numberRow(key, `${spec.label} ${'XYZ'[i]}`, value[i], (spec.default as number[])[i], -1, 1));
        if (typeof binding !== 'string') return null;
        const control = effect.type === 'voxel-relief' ? VOXEL_RELIEF_PARAMS[binding]
          : parameterSchema?.[binding];
        if (spec.type === 'boolean') return <ResolveInspectorRow key={spec.id} label={spec.label}><input aria-label={`${operator.label} ${spec.label}`} type="checkbox" checked={Boolean(value)} onChange={event => set(binding, event.target.checked)} /></ResolveInspectorRow>;
        if (spec.type === 'color') return <ResolveInspectorRow key={spec.id} label={spec.label}><OperatorColorInput ariaLabel={`${operator.label} ${spec.label}`}
          value={String(value)} onChange={next => set(binding, next)} /></ResolveInspectorRow>;
        if (spec.type === 'select') {
          const select = control?.type === 'select' ? control : spec;
          const selected = operator.id === 'values.choice' && control?.type === 'select'
            ? resolveImageOperatorChoiceValue(binding, evaluatedParams, { parameterSchema })
            : String(value);
          return <ResolveInspectorRow key={spec.id} label={select.label}><InspectorSelect ariaLabel={`${operator.label} ${select.label}`}
            value={selected} options={[...(select.options ?? [])]} onChange={next => set(binding, next)}
            onReset={control?.type === 'select' ? () => set(binding, control.default) : undefined} /></ResolveInspectorRow>;
        }
        return numberRow(binding, control?.label ?? spec.label, Number(value), Number(control?.default ?? spec.default), control?.min ?? spec.min, control?.max ?? spec.max, control?.step ?? spec.step, control?.animatable ?? spec.animatable);
      })}
      {projectedNode && node.operator.startsWith('math.') && node.operator !== 'math.constant' &&
        <OperatorLiveValue clipId={clip.id} node={projectedNode} portId="value" label="Result" direction="output" />}
      {!operator.parameters.length && operator.id !== 'glyph.atlas' && <p className="face-cable-hint">{operator.description}</p>}
    </ResolveInspectorSection>
    <OperatorConnections graph={graph} node={node} clipId={clip.id} effectId={effectId} safely={safely} />
    {operator.id === 'scene.transform' && <TransformTab clipId={clip.id} transform={clip.transform} is3D={clip.is3D} speed={clip.speed} />}
    {operator.id === 'tracking.face' && <PreciseFaceTrackingControls clipId={clip.id} />}
    {effect.type === 'face-cables' && operator.invalidates !== 'appearance' && <p className="face-cable-hint">Bake cables to apply changes to playback and export. Saved depth can be reused for physics.</p>}
    {effect.type === 'voxel-relief' && clip.is3D && ['camera.orbit', 'render.voxel'].includes(operator.id) && <p className="face-cable-hint">Native 3D uses the scene camera. Smoothing and ray steps apply only in 2D.</p>}
    {message && <p role="alert">{message}</p>}
  </div>;
}

/** The effect form is another view of the same graph parameter bindings. */
export function AdditionalOperatorControls({ clipId, effectId }: { clipId: string; effectId: string }) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  if (!clip) return null;
  const effect = clip.effects.find(e => e.id === effectId); if (!effect) return null;
  let graph;
  try { graph = effectOperatorGraph(effect); } catch { return null; }
  return <>{graph.nodes.filter(n => n.id !== 'wind' && ((getEffectOperator(n.operator)?.addable && Boolean(getEffectOperator(n.operator)?.parameters.length) && n.id !== 'calibration') || ['tracking.smooth', 'geometry.merge-surface'].includes(n.operator)))
    .map(n => <OperatorParameters key={n.id} clip={clip} effectId={effectId} nodeId={n.id} />)}</>;
}

export function AddOperatorControl({ clipId, effectId, onAdded }: { clipId: string; effectId: string; onAdded?: (id: string) => void }) {
  const [message, setMessage] = useState('');
  const type = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.effects.find(effect => effect.id === effectId)?.type ?? '');
  return <><InspectorSelect ariaLabel="Add reusable node" value="" options={[{ value: '', label: 'Add node…' }, ...addableEffectOperators(type).map(o => ({ value: o.id, label: o.label }))]}
    onChange={value => { if (!value) return; try { const id = createEffectGraphActions(clipId, effectId).addNode(value); setMessage(''); onAdded?.(id); } catch (error) { setMessage(String(error)); } }} />
    {message && <p role="alert">{message}</p>}</>;
}
