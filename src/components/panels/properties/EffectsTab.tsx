import { SplatExplorationControls } from './SplatExplorationControls';
// Effects Tab - Add and configure visual/audio effects
import { Fragment, Suspense, useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useEngineStore } from '../../../stores/engineStore';
import { startBatch, endBatch } from '../../../stores/historyStore';
import {
  createEffectProperty,
  type AnimatableProperty,
} from '../../../types/animationProperties';
import type { AudioEffectParamValue } from '../../../types/audio';
import { isAudioEffect, type EffectType } from '../../../types/effects';
import { EFFECT_REGISTRY, getDefaultParams, getCategoriesWithEffects } from '../../../effects';
import { groupEffectParameters } from '../../../effects/parameterGroups';
import { VoxelReliefControls } from './VoxelReliefControls';
import { EXTRA_CONTROLS_REGISTRY } from '../../../effects/extraControlsRegistry';
import '../../../effects/effectParameterGroups.css';
import { addParticleDisintegrateOutroPreset } from '../../../effects/presets/particleDisintegrateOutro';
import {
  EffectKeyframeToggle,
} from './shared';
import { LabeledValue } from './LabeledValue';
import { VolumeTab } from './VolumeTab';
import { ColorGraphEffectEntry } from './ColorGraphEffectEntry';
import { ParameterSourceNumberRow } from './ParameterSourceNumberRow';
import { getParameterSourceTarget } from '../../../services/parameterSources/parameterSourceTargets';
import { resolveLinkedAudioClip } from '../../../services/nodeGraph/clipGraphProjectionAudio';
import { LandmarkTrackingControls } from './LandmarkTrackingControls';
import { EffectCatalogPicker } from './EffectCatalogPicker';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
import './effectValueControls.css';

type PrimitiveEffectParamValue = number | boolean | string;
type PrimitiveEffectParams = Record<string, PrimitiveEffectParamValue>;
type EffectParamsRecord = Record<string, AudioEffectParamValue>;

function toPrimitiveEffectParams(
  params: EffectParamsRecord | undefined,
  defaults: PrimitiveEffectParams = {},
): PrimitiveEffectParams {
  const primitiveParams: PrimitiveEffectParams = { ...defaults };
  for (const [key, value] of Object.entries(params ?? {})) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') {
      primitiveParams[key] = value;
    }
  }
  return primitiveParams;
}

// Single parameter control renderer
function renderParamControl(
  paramName: string,
  paramDef: { type: string; label: string; default: PrimitiveEffectParamValue; min?: number; max?: number; step?: number; options?: { value: string; label: string }[]; animatable?: boolean },
  value: PrimitiveEffectParamValue,
  effect: { id: string; params: PrimitiveEffectParams },
  onChange: (params: PrimitiveEffectParams) => void,
  defaults: PrimitiveEffectParams,
  clipId?: string,
  noMaxLimit?: boolean,
  onDragStart?: () => void,
  onDragEnd?: () => void,
  onParamCommit?: (
    paramName: string,
    controlKind: 'checkbox' | 'number' | 'select',
    inputMethod: 'click' | 'drag' | 'keyboard' | 'reset' | 'select' | 'type',
  ) => void,
) {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const defaultValue = defaults[paramName];
    if (defaultValue !== undefined) onChange({ ...effect.params, [paramName]: defaultValue });
  };

  const renderKfToggle = (val: number) => {
    if (!clipId) return null;
    return <EffectKeyframeToggle clipId={clipId} effectId={effect.id} paramName={paramName} value={val} />;
  };

  switch (paramDef.type) {
    case 'number': {
      const sourceClip = clipId ? useTimelineStore.getState().clips.find(clip => clip.id === clipId) : undefined;
      const property = `effect.${effect.id}.${paramName}`;
      if (sourceClip && getParameterSourceTarget(sourceClip, property)) return <ParameterSourceNumberRow key={paramName} clipId={sourceClip.id} property={property} />;
      const min = paramDef.min ?? 0;
      // For quality params with noMaxLimit, allow much higher values
      const max = noMaxLimit ? (paramDef.max ?? 1) * 10 : (paramDef.max ?? 1);
      const range = max - min;
      const decimals = paramDef.step && paramDef.step >= 1 ? 0 : paramDef.step && paramDef.step >= 0.1 ? 1 : 2;
      const persistenceKey = `effect.${clipId ?? 'global'}.${effect.id}.${paramName}`;
      const midiTarget = clipId ? {
        clipId,
        property: createEffectProperty(effect.id, paramName),
        label: paramDef.label,
        currentValue: value as number,
        min,
        max,
      } : null;
      return (
        <div className="control-row effect-param-row" key={paramName}>
          <LabeledValue
            className="effect-param-value"
            label={paramDef.label}
            value={value as number}
            onChange={(v) => onChange({ ...effect.params, [paramName]: v })}
            defaultValue={paramDef.default as number}
            sensitivity={Math.max(0.5, range / 100)}
            decimals={decimals}
            min={min}
            max={noMaxLimit ? undefined : max}
            persistenceKey={persistenceKey}
            ariaLabel={paramDef.label}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onCommit={(method) => onParamCommit?.(paramName, 'number', method)}
            keyframeToggle={paramDef.animatable ? renderKfToggle(value as number) : undefined}
            midiTarget={midiTarget}
          />
        </div>
      );
    }

    case 'boolean':
      return (
        <div className="control-row checkbox-row" key={paramName}>
          <label>
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => {
                onChange({ ...effect.params, [paramName]: e.target.checked });
                onParamCommit?.(paramName, 'checkbox', 'click');
              }}
            />
            {paramDef.label}
          </label>
        </div>
      );

    case 'select':
      return (
        <div className="control-row" key={paramName}>
          <label>{paramDef.label}</label>
          <select
            value={value as string}
            onChange={(e) => {
              onChange({ ...effect.params, [paramName]: e.target.value });
              onParamCommit?.(paramName, 'select', 'select');
            }}
          >
            {paramDef.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      );

    case 'text':
      return (
        <div className="control-row" key={paramName} onContextMenu={handleContextMenu}>
          <label>{paramDef.label}</label>
          <input
            type="text"
            value={value as string}
            onFocus={onDragStart}
            onChange={(e) => onChange({ ...effect.params, [paramName]: e.target.value })}
            onBlur={() => {
              onDragEnd?.();
              onParamCommit?.(paramName, 'number', 'type');
            }}
          />
        </div>
      );

    default:
      return null;
  }
}

// Effect parameters with collapsible Quality section
interface EffectParamsProps {
  effect: { id: string; type: string; params: PrimitiveEffectParams };
  onChange: (params: PrimitiveEffectParams) => void;
  clipId?: string;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onParamCommit?: (
    paramName: string,
    controlKind: 'checkbox' | 'number' | 'select',
    inputMethod: 'click' | 'drag' | 'keyboard' | 'reset' | 'select' | 'type',
  ) => void;
}

function EffectParams({ effect, onChange, clipId, onDragStart, onDragEnd, onParamCommit }: EffectParamsProps) {
  const [qualityExpanded, setQualityExpanded] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

  const effectDef = EFFECT_REGISTRY.get(effect.type);
  if (!effectDef) {
    return <p className="effect-info">Unknown effect type: {effect.type}</p>;
  }

  const defaults = getDefaultParams(effect.type);

  if (Object.keys(effectDef.params).length === 0) {
    return <p className="effect-info">No parameters</p>;
  }

  if (effect.type === 'splat-exploration' && clipId) return <SplatExplorationControls clipId={clipId} effectId={effect.id} />;
  if (effect.type === 'voxel-relief' && clipId) return <VoxelReliefControls clipId={clipId} effectId={effect.id} />;

  const parameterGroups = groupEffectParameters(effectDef.params);
  const ExtraControls = EXTRA_CONTROLS_REGISTRY[effectDef.id];
  const ungroupedParams = parameterGroups.find((group) => group.id === '__ungrouped__')?.params ?? [];
  const namedGroups = parameterGroups.filter((group) => !group.quality && group.label);
  const qualityParams = parameterGroups.find((group) => group.quality)?.params ?? [];

  const handleResetQuality = () => {
    const resetParams: PrimitiveEffectParams = { ...effect.params };
    qualityParams.forEach(([name, def]) => {
      resetParams[name] = def.default;
    });
    onDragStart?.();
    try {
      onChange(resetParams);
    } finally {
      onDragEnd?.();
    }
    onParamCommit?.('quality', 'number', 'reset');
  };

  return (
    <>
      {ungroupedParams.length > 0 && (
        <div className="effect-param-section">
          {ungroupedParams.map(([paramName, paramDef]) => {
            const value = effect.params[paramName] ?? paramDef.default;
            return renderParamControl(paramName, paramDef, value, effect, onChange, defaults, clipId, false, onDragStart, onDragEnd, onParamCommit);
          })}
        </div>
      )}

      {namedGroups.map((group) => {
        const isExpanded = expandedGroups[group.id] ?? group.id !== 'group:camera';
        return (
          <div className="effect-quality-section" key={group.id}>
            <div
              className="effect-quality-header"
              onClick={() => setExpandedGroups((current) => ({
                ...current,
                [group.id]: !isExpanded,
              }))}
            >
              <span className="effect-quality-toggle">{isExpanded ? '\u25BC' : '\u25B6'}</span>
              <span className="effect-quality-title">{group.label}</span>
            </div>
            {isExpanded && (
              <div className="effect-quality-params">
                {group.params.map(([paramName, paramDef]) => {
                  const value = effect.params[paramName] ?? paramDef.default;
                  return renderParamControl(paramName, paramDef, value, effect, onChange, defaults, clipId, false, onDragStart, onDragEnd, onParamCommit);
                })}
              </div>
            )}
          </div>
        );
      })}

      {/* Quality section (collapsible) */}
      {qualityParams.length > 0 && (
        <div className="effect-quality-section">
          <div className="effect-quality-header" onClick={() => setQualityExpanded(!qualityExpanded)}>
            <span className="effect-quality-toggle">{qualityExpanded ? '\u25BC' : '\u25B6'}</span>
            <span className="effect-quality-title">Quality</span>
            {qualityExpanded && (
              <button
                className="btn btn-xs effect-quality-reset"
                onClick={(e) => { e.stopPropagation(); handleResetQuality(); }}
                title="Reset quality to defaults"
              >
                Reset
              </button>
            )}
          </div>
          {qualityExpanded && (
            <div className="effect-quality-params">
              {qualityParams.map(([paramName, paramDef]) => {
                const value = effect.params[paramName] ?? paramDef.default;
                // Quality params have no max limit when dragging
                return renderParamControl(paramName, paramDef, value, effect, onChange, defaults, clipId, true, onDragStart, onDragEnd, onParamCommit);
              })}
              <div className="effect-quality-warning">
                High values may cause slowdowns
              </div>
            </div>
          )}
        </div>
      )}

      {ExtraControls && (
        <div className="effect-extra-controls">
          <Suspense fallback={null}>
            <ExtraControls effectInstanceId={effect.id} effectId={effect.type} params={effect.params} onChange={onChange} clipId={clipId} />
          </Suspense>
        </div>
      )}
    </>
  );
}

interface EffectsTabProps {
  clipId: string;
  effects: Array<{ id: string; name: string; type: string; enabled: boolean; params: EffectParamsRecord }>;
  isAudioClip?: boolean;
}

const MOTION_ADJUSTMENT_EFFECT_TYPES = new Set([
  'brightness',
  'contrast',
  'saturation',
  'invert',
  'gaussian-blur',
]);

export function EffectsTab({ clipId, effects, isAudioClip }: EffectsTabProps) {
  const [showAudioEffects, setShowAudioEffects] = useState(false);
  const audioMode = Boolean(isAudioClip || showAudioEffects);
  // Reactive data - subscribe to specific values only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const clips = useTimelineStore(state => state.clips);
  const effectOrbitTarget = useEngineStore(state => state.effectOrbitTarget);
  const setEffectOrbitTarget = useEngineStore(state => state.setEffectOrbitTarget);
  // Actions from getState() - stable, no subscription needed
  const { addClipEffect, addKeyframe, removeClipEffect, updateClipEffect, setClipEffectEnabled, reorderClipEffect, setPropertyValue, getInterpolatedEffects } = useTimelineStore.getState();

  // Drag-and-drop reorder state
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);
  const [collapsedEffectIds, setCollapsedEffectIds] = useState<Set<string>>(() => new Set());

  const previousEnabled = useRef(new Map<string, boolean>());
  useEffect(() => {
    const bypassed = effects.filter(effect => effect.enabled === false && previousEnabled.current.get(effect.id) !== false);
    previousEnabled.current = new Map(effects.map(effect => [effect.id, effect.enabled !== false]));
    if (bypassed.length) setCollapsedEffectIds(current => new Set([...current, ...bypassed.map(effect => effect.id)]));
  }, [effects]);

  const toggleEffectCollapsed = useCallback((effectId: string) => {
    setCollapsedEffectIds((current) => {
      const next = new Set(current);
      if (next.has(effectId)) {
        next.delete(effectId);
      } else {
        next.add(effectId);
      }
      return next;
    });
  }, []);

  const handleBatchStart = useCallback(() => startBatch('Adjust effect'), []);
  const handleBatchEnd = useCallback(() => endBatch(), []);
  const clip = clips.find(c => c.id === clipId);
  const linkedClip = clip?.linkedClipId ? clips.find(candidate => candidate.id === clip.linkedClipId)
    : clips.find(candidate => candidate.linkedClipId === clipId);
  const audioClip = clip ? resolveLinkedAudioClip(clip, linkedClip) : undefined;
  const hasColorEntry = Boolean(clip?.colorCorrection || clip?.nodeGraph?.forcedBuiltIns?.includes('color'));
  const isMotionAdjustmentClip = clip?.source?.type === 'motion-adjustment';
  const clipLocalTime = clip ? playheadPosition - clip.startTime : 0;
  let interpolatedEffects = effects, controlError = '';
  try { interpolatedEffects = getInterpolatedEffects(clipId, clipLocalTime); }
  catch (error) { controlError = error instanceof Error ? error.message : String(error); }
  const handleAddParticleDisintegrateOutro = useCallback(() => {
    if (!clip) return;
    startBatch('Add particle disintegrate out');
    try {
      addParticleDisintegrateOutroPreset({
        clipId,
        clipDuration: clip.duration,
        addClipEffect,
        addKeyframe,
      });
      trackEditorControlCommitted({
        area: 'effect',
        controlId: 'particle-disintegrate-out',
        controlKind: 'button',
        inputMethod: 'click',
        interaction: 'add',
        itemId: 'particle-disintegrate-out',
        itemKind: 'preset',
      });
    } finally {
      endBatch();
    }
  }, [addClipEffect, addKeyframe, clip, clipId]);

  // Get effects grouped by category from registry (video effects only)
  const effectCategories = useMemo(() => {
    const categories = getCategoriesWithEffects();
    if (!isMotionAdjustmentClip) return categories;
    return categories
      .map(({ category, effects: categoryEffects }) => ({
        category,
        effects: categoryEffects.filter((effect) => MOTION_ADJUSTMENT_EFFECT_TYPES.has(effect.id)),
      }))
      .filter(({ effects: categoryEffects }) => categoryEffects.length > 0);
  }, [isMotionAdjustmentClip]);

  // Video effects only (exclude audio effects from the list)
  const videoEffects = useMemo(() =>
    effects.filter(e => !isAudioEffect(e.type as EffectType)),
    [effects]
  );
  const colorStackIndex = hasColorEntry
    ? Math.min(videoEffects.length, Math.max(0, Math.trunc(clip?.colorCorrection?.stackIndex ?? 0)))
    : -1;

  return (
    <div className="properties-tab-content effects-tab transform-tab-compact" onPointerUp={event => {
      // Leave numeric editing and native select popups alone; clear transient button focus only.
      if (event.target instanceof Element) event.target.closest<HTMLElement>('button,input[type="checkbox"]')?.blur();
    }}>
      <div className="effect-add-row">
        <div className="effect-mode-toggle" role="group" aria-label="Effect type">
          <button type="button" className={`effect-mode-btn${!audioMode ? ' active' : ''}`}
            aria-pressed={!audioMode} disabled={isAudioClip} onClick={() => setShowAudioEffects(false)}>Video</button>
          <button type="button" className={`effect-mode-btn${audioMode ? ' active' : ''}`}
            aria-pressed={audioMode} title="Show audio effects" onClick={() => setShowAudioEffects(true)}>Audio</button>
        </div>
        <span className="effect-mode-label">{audioMode ? 'Audio effects' : 'Video effects'}</span>
      </div>
      {!audioMode && clip && <LandmarkTrackingControls clipId={clipId} />}
      {!audioMode && (
        <EffectCatalogPicker
          groups={effectCategories}
          sourceFrameId={`${clipId}:${Math.floor(playheadPosition * 30)}`}
          onSelect={(effectId) => {
            addClipEffect(clipId, effectId as EffectType);
            trackEditorControlCommitted({
              area: 'effect',
              controlId: 'effect-catalog',
              controlKind: 'select',
              inputMethod: 'select',
              interaction: 'add',
              itemId: effectId,
              itemKind: 'effect',
            });
          }}
        />
      )}
      {!audioMode && <div className="effect-add-row">
        {!isAudioClip && (
          <>
            {!isMotionAdjustmentClip && (
              <button
                type="button"
                className="btn btn-sm"
                disabled={!clip}
                onClick={handleAddParticleDisintegrateOutro}
                title="Add particle disintegrate outro"
              >
                Particle Out
              </button>
            )}
            {isMotionAdjustmentClip && (
              <span className="effect-mode-label">Adjustment-safe effects</span>
            )}
          </>
        )}
      </div>}

      {audioMode ? (
        audioClip ? <>
          {audioClip.id !== clipId && <p className="effect-info">Linked audio: {audioClip.name}</p>}
          <VolumeTab key={audioClip.id} clipId={audioClip.id} effects={audioClip.effects ?? []} />
        </> : <div className="panel-empty"><p>This clip has no audio source.</p></div>
      ) : (
        <div className="effects-list">
          {controlError && <p role="alert" className="parameter-source-error">{controlError}</p>}
          {clip && colorStackIndex === 0 && <ColorGraphEffectEntry key={clipId} clip={clip} visualEffectCount={videoEffects.length} />}
          {videoEffects.length === 0 && !hasColorEntry && <div className="panel-empty"><p>No effects applied</p></div>}
          {videoEffects.map((effect, idx) => {
            const interpolated = interpolatedEffects.find(e => e.id === effect.id) || effect;
            const effectDef = EFFECT_REGISTRY.get(effect.type);
            const primitiveParams = toPrimitiveEffectParams(
              interpolated.params,
              effectDef ? getDefaultParams(effect.type) : {},
            );
            const isEnabled = effect.enabled !== false; // default to true if undefined
            const isOrbitActive = effectOrbitTarget?.clipId === clipId && effectOrbitTarget.effectId === effect.id;
            const isDragging = dragIdx === idx;
            const isDropTarget = dropIdx === idx;
            const isCollapsed = collapsedEffectIds.has(effect.id);
            return (<Fragment key={effect.id}>
              <div
                className={`effect-item ${!isEnabled ? 'bypassed' : ''} ${isDragging ? 'dragging' : ''} ${isDropTarget ? 'drop-target' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = 'move';
                  setDropIdx(idx);
                }}
                onDragLeave={() => { if (dropIdx === idx) setDropIdx(null); }}
                onDrop={(e) => {
                  e.preventDefault();
                  const fromIdx = dragIdx ?? parseInt(e.dataTransfer.getData('text/plain'), 10);
                  const movedEffect = videoEffects[fromIdx];
                  const targetIndex = effects.findIndex(candidate => candidate.id === effect.id);
                  if (movedEffect && fromIdx !== idx && targetIndex >= 0) {
                    startBatch('Reorder effect');
                    reorderClipEffect(clipId, movedEffect.id, targetIndex);
                    endBatch();
                    trackEditorControlCommitted({
                      area: 'effect',
                      controlId: 'effect-stack-order',
                      controlKind: 'drag',
                      inputMethod: 'drag',
                      interaction: 'reorder',
                      itemId: movedEffect.type,
                      itemKind: 'effect',
                    });
                  }
                  setDragIdx(null);
                  setDropIdx(null);
                }}
                onDragEnd={() => { setDragIdx(null); setDropIdx(null); }}
              >
                <div className="effect-header">
                  <span
                    className="effect-drag-handle"
                    title="Drag to reorder"
                    draggable
                    onDragStart={(e) => {
                      setDragIdx(idx);
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(idx));
                    }}
                  >&#x2630;</span>
                  <button
                    type="button"
                    className="effect-collapse-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleEffectCollapsed(effect.id)}
                    title={isCollapsed ? `Expand ${effect.name}` : `Collapse ${effect.name}`}
                  >
                    <span className="effect-collapse-chevron" aria-hidden="true">
                      {isCollapsed ? '\u25B6' : '\u25BC'}
                    </span>
                    <span className="effect-name">{effect.name}</span>
                  </button>
                  <button
                    className={`effect-bypass-btn ${!isEnabled ? 'bypassed' : ''}`}
                    onClick={() => {
                      setClipEffectEnabled(clipId, effect.id, !isEnabled);
                      trackEditorControlCommitted({
                        area: 'effect',
                        controlId: 'effect-enabled',
                        controlKind: 'toggle',
                        inputMethod: 'click',
                        interaction: isEnabled ? 'disable' : 'enable',
                        itemId: effect.type,
                        itemKind: 'effect',
                      });
                    }}
                    title={isEnabled ? 'Bypass effect' : 'Enable effect'}
                  >
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
                      {isEnabled ? (
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                      ) : (
                        <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />
                      )}
                      {isEnabled && <polyline points="22 4 12 14.01 9 11.01" />}
                    </svg>
                  </button>
                  {effectDef && 'cameraInteraction' in effectDef && effectDef.cameraInteraction && isEnabled && !clip?.is3D && (
                    <button
                      className={`effect-bypass-btn ${isOrbitActive ? '' : 'bypassed'}`}
                      onClick={() => setEffectOrbitTarget(isOrbitActive ? null : { clipId, effectId: effect.id })}
                      title="Orbit in Preview: drag/touch = orbit, Shift+drag or two-finger move = pan, wheel/pinch = distance"
                    >
                      Orbit
                    </button>
                  )}
                  <button className="btn btn-sm btn-danger" onClick={() => {
                    removeClipEffect(clipId, effect.id);
                    trackEditorControlCommitted({
                      area: 'effect',
                      controlId: 'effect-remove',
                      controlKind: 'button',
                      inputMethod: 'click',
                      interaction: 'remove',
                      itemId: effect.type,
                      itemKind: 'effect',
                    });
                  }}>×</button>
                </div>
                {!isCollapsed && (
                  <div className="effect-params">
                    <EffectParams
                      effect={{ ...effect, params: primitiveParams }}
                      onDragStart={handleBatchStart}
                      onDragEnd={handleBatchEnd}
                      onParamCommit={(paramName, controlKind, inputMethod) => {
                        trackEditorControlCommitted({
                          area: 'effect',
                          controlId: paramName,
                          controlKind,
                          inputMethod,
                          interaction: inputMethod === 'reset' ? 'reset' : 'change',
                          itemId: effect.type,
                          itemKind: 'effect',
                        });
                      }}
                      onChange={(params) => {
                        Object.entries(params).forEach(([paramName, value]) => {
                          if (typeof value === 'number') {
                            setPropertyValue(clipId, `effect.${effect.id}.${paramName}` as AnimatableProperty, value);
                          } else {
                            updateClipEffect(clipId, effect.id, { [paramName]: value });
                          }
                        });
                      }}
                      clipId={clipId}
                    />
                  </div>
                )}
              </div>
              {clip && colorStackIndex === idx + 1 && <ColorGraphEffectEntry clip={clip} visualEffectCount={videoEffects.length} />}
            </Fragment>);
          })}
        </div>
      )}
    </div>
  );
}
