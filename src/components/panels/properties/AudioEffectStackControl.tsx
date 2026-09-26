import { useState, type ReactNode } from 'react';
import { EffectCard } from './EffectCard';
import { AudioEffectPicker } from './AudioEffectPicker';
import type { AudioDynamicsReductionSnapshot, AudioEffectInstance } from '../../../types';
import type { AudioEqAnalyzerView } from '../../../engine/audio/eq/AudioEqTypes';
import './VolumeBlendshapeTabs.css';
import './AudioEffectsInspector.css';
import {
  getAudioEffect,
  type AudioEffectParamValue,
} from '../../../engine/audio/AudioEffectRegistry';
import { normalizeAudioEqParams } from '../../../engine/audio/eq/AudioEqLegacy';
import { EffectKeyframeToggle, MultiKeyframeToggle } from './shared';
import { createAudioDynamicsViewModel } from './audioDynamicsView';
import { FlexEqualizerControl } from './FlexEqualizerControl';
import { getAudioEqAllNumericKeyframeEntries } from './audioEqKeyframes';
import type { RuntimeAnalyzerScope } from './useThrottledRuntimeAnalyzer';
import { endBatch, startBatch } from '../../../stores/historyStore';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
import { useDockStore } from '../../../stores/dockStore';
import { requestNodeWorkspaceView } from '../../../services/nodeGraph/nodeWorkspaceNavigation';
import { ResolveInspectorIconButton, ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';

import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../inspector/InspectorSelect';

function trackAudioEffectControl(
  descriptorId: string,
  controlId: string,
  controlKind: 'button' | 'checkbox' | 'number' | 'select',
  inputMethod: 'click' | 'drag' | 'reset' | 'select' | 'type',
  interaction: 'add' | 'change' | 'disable' | 'enable' | 'remove' | 'reorder' | 'reset',
) {
  trackEditorControlCommitted({
    area: 'audio',
    controlId,
    controlKind,
    inputMethod,
    interaction,
    itemId: descriptorId,
    itemKind: 'audio_effect',
  });
}

export interface AudioEffectStackControlProps {
  title?: string;
  beforeEffects?: ReactNode;
  effects: readonly AudioEffectInstance[];
  emptyLabel?: string;
  addLabel?: string;
  className?: string;
  excludeDescriptorIds?: ReadonlySet<string>;
  keyframeClipId?: string;
  runtimeDynamics?: Readonly<Record<string, AudioDynamicsReductionSnapshot>>;
  runtimeAnalyzer?: AudioEqAnalyzerView;
  runtimeAnalyzerScope?: RuntimeAnalyzerScope;
  runtimeAnalyzerTrackId?: string;
  onAddEffect?: (descriptorId: string) => void;
  onUpdateEffect: (effect: AudioEffectInstance, paramName: string, value: AudioEffectParamValue) => void;
  onSetEffectEnabled: (effectId: string, enabled: boolean) => void;
  onRemoveEffect: (effectId: string) => void;
  onReorderEffect: (effectId: string, newIndex: number) => void;
}

function formatParamLabel(paramName: string): string {
  return paramName
    .replace(/Db\b/g, ' dB')
    .replace(/Hz\b/g, ' Hz')
    .replace(/Ms\b/g, ' ms')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, char => char.toUpperCase());
}

function getParamControlMeta(
  paramName: string,
  defaultValue: AudioEffectParamValue,
): { min: number; max: number; decimals: number; suffix: string; sensitivity: number } {
  if (paramName.toLowerCase().includes('frequencyhz')) return { min: 20, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'q') {
    const defaultQ = typeof defaultValue === 'number' ? defaultValue : 1;
    return { min: 0.1, max: Math.max(24, defaultQ * 2, 80), decimals: 2, suffix: '', sensitivity: 0.08 };
  }
  if (paramName === 'harmonics') return { min: 1, max: 8, decimals: 0, suffix: '', sensitivity: 0.1 };
  if (paramName.includes('thresholdDb')) return { min: -80, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName === 'reductionDb') return { min: 0, max: 60, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('rangeDb')) return { min: 0, max: 80, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('floorDb')) return { min: -100, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('ceilingDb')) return { min: -24, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.15 };
  if (paramName === 'targetPeakDb') return { min: -24, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.15 };
  if (paramName === 'targetRmsDb') return { min: -60, max: 0, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName === 'targetLufs') return { min: -70, max: 0, decimals: 1, suffix: ' LUFS', sensitivity: 0.25 };
  if (paramName === 'maxGainDb') return { min: 0, max: 60, decimals: 1, suffix: ' dB', sensitivity: 0.25 };
  if (paramName.includes('makeupGainDb') || paramName.includes('inputGainDb')) return { min: -24, max: 24, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'gainDb') return { min: -24, max: 24, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'pan') return { min: -1, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'driveDb') return { min: 0, max: 36, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'sourceChannel') return { min: 0, max: 7, decimals: 0, suffix: '', sensitivity: 0.1 };
  if (paramName === 'threshold') return { min: 0.01, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName.includes('kneeDb')) return { min: 0, max: 40, decimals: 1, suffix: ' dB', sensitivity: 0.2 };
  if (paramName === 'ratio') return { min: 1, max: 20, decimals: 2, suffix: ':1', sensitivity: 0.05 };
  if (paramName.includes('attackMs')) return { min: 0.1, max: 500, decimals: 1, suffix: ' ms', sensitivity: 1 };
  if (paramName.includes('releaseMs')) return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'delayMs') return { min: 1, max: 2000, decimals: 0, suffix: ' ms', sensitivity: 4 };
  if (paramName === 'feedback') return { min: 0, max: 0.95, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'mix') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'sensitivity') return { min: 0.1, max: 4, decimals: 2, suffix: '', sensitivity: 0.02 };
  if (paramName === 'toneHz') return { min: 200, max: 22000, decimals: 0, suffix: ' Hz', sensitivity: 60 };
  if (paramName === 'roomSize') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (paramName === 'decaySeconds') return { min: 0.1, max: 12, decimals: 2, suffix: ' s', sensitivity: 0.05 };
  if (paramName === 'damping') return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
  if (typeof defaultValue === 'number') return { min: -100, max: 100, decimals: 2, suffix: '', sensitivity: 0.5 };
  return { min: 0, max: 1, decimals: 2, suffix: '', sensitivity: 0.01 };
}

function getAudioEffectValue(
  effect: AudioEffectInstance,
  paramName: string,
  defaultValue: AudioEffectParamValue,
): AudioEffectParamValue {
  return effect.params[paramName] ?? defaultValue;
}

export function AudioEffectStackControl({
  title = 'Audio FX Stack',
  beforeEffects,
  effects,
  emptyLabel = 'No audio effects',
  addLabel = '+ Add Effect',
  className,
  excludeDescriptorIds,
  keyframeClipId,
  runtimeDynamics,
  runtimeAnalyzer,
  runtimeAnalyzerScope,
  runtimeAnalyzerTrackId,
  onAddEffect,
  onUpdateEffect,
  onSetEffectEnabled,
  onRemoveEffect,
  onReorderEffect,
}: AudioEffectStackControlProps) {
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const [draggedEffectId, setDraggedEffectId] = useState<string | null>(null);
  const [dropEffectId, setDropEffectId] = useState<string | null>(null);
  const reorder = (effect: AudioEffectInstance, index: number) => {
    onReorderEffect(effect.id, index);
    trackAudioEffectControl(effect.descriptorId, 'effect-stack-order', 'button', 'click', 'reorder');
  };

  return (
    <div className={`audio-effect-stack-control ${className ?? ''}`} onPointerUp={event => {
      if (event.target instanceof Element) event.target.closest<HTMLElement>('button,input[type="checkbox"]')?.blur();
    }}>
      {onAddEffect && <AudioEffectPicker title={addLabel} excludeDescriptorIds={excludeDescriptorIds}
        allowAudioMath={Boolean(keyframeClipId)} onSelect={id => {
          onAddEffect(id);
          trackAudioEffectControl(id, 'effect-stack-add', 'select', 'select', 'add');
        }} />}
      {beforeEffects}
      {!onAddEffect && <h4>{title}</h4>}

      {effects.length === 0 ? (
        <div className="panel-empty"><p>{emptyLabel}</p></div>
      ) : (
        <div className="audio-effect-stack-list">
          {effects.map((effect, index) => {
            const descriptor = getAudioEffect(effect.descriptorId);
            if (!descriptor) return null;
            const enabled = effect.enabled !== false;
            const dynamicsView = createAudioDynamicsViewModel(effect, descriptor.name, runtimeDynamics?.[effect.id]);
            const isFlexEqualizer = descriptor.id === 'audio-eq';
            const eqAllKeyframeEntries = isFlexEqualizer && keyframeClipId
              ? getAudioEqAllNumericKeyframeEntries(
                  effect.id,
                  normalizeAudioEqParams(effect.params).audible.bands,
                )
              : [];
            return (
              <EffectCard key={effect.id} title={descriptor.name} colorIdentity={`effect:${effect.id}`}
                className={`audio-effect-inspector-item ${draggedEffectId === effect.id ? 'dragging' : ''} ${dropEffectId === effect.id ? 'drop-target' : ''}`} enabled={enabled}
                dragHandleProps={{ draggable: true, onDragStart: event => {
                  setDraggedEffectId(effect.id); event.dataTransfer.effectAllowed = 'move';
                  event.dataTransfer.setData('text/plain', effect.id);
                } }}
                onDragOver={event => { if (draggedEffectId) { event.preventDefault(); setDropEffectId(effect.id); } }}
                onDragLeave={() => setDropEffectId(null)}
                onDragEnd={() => { setDraggedEffectId(null); setDropEffectId(null); }}
                onDrop={event => {
                  event.preventDefault();
                  const moved = effects.find(candidate => candidate.id === draggedEffectId);
                  if (moved && moved.id !== effect.id) reorder(moved, index);
                  setDraggedEffectId(null); setDropEffectId(null);
                }}
                onMoveEarlier={index > 0 ? () => reorder(effect, index - 1) : undefined}
                onMoveLater={index < effects.length - 1 ? () => reorder(effect, index + 1) : undefined}
                onRemove={() => {
                  onRemoveEffect(effect.id);
                  trackAudioEffectControl(descriptor.id, 'effect-remove', 'button', 'click', 'remove');
                }}
                onEnabledChange={(next) => {
                  onSetEffectEnabled(effect.id, next);
                  trackAudioEffectControl(descriptor.id, 'effect-enabled', 'button', 'click', next ? 'enable' : 'disable');
                }}
                headerActions={<>
                  {keyframeClipId && eqAllKeyframeEntries.length > 0 && <MultiKeyframeToggle
                    clipId={keyframeClipId} entries={eqAllKeyframeEntries}
                    dragId={`${keyframeClipId}:effect:${effect.id}:eq-all`} title="Add all EQ parameter keyframes" />}
                </>}>
                {dynamicsView && (
                  <div className={`audio-dynamics-view ${dynamicsView.effectId}`}>
                    <div className="audio-dynamics-meter">
                      <svg viewBox="0 0 100 100" role="img" aria-label={`${dynamicsView.title} transfer curve`} preserveAspectRatio="none">
                        <line className="audio-dynamics-reference" x1="0" y1="100" x2="100" y2="0" />
                        <polyline className="audio-dynamics-curve" points={dynamicsView.points} />
                        {dynamicsView.markers.map((item) => (
                          <g key={item.label}>
                            <circle cx={item.xPercent} cy={item.yPercent} r="2.4" />
                            <text x={item.xPercent} y={Math.max(8, item.yPercent - 4)}>{item.label}</text>
                          </g>
                        ))}
                      </svg>
                    </div>
                    <div className="audio-dynamics-readout">
                      <strong>{dynamicsView.primary}</strong>
                      <span>{dynamicsView.secondary}</span>
                    </div>
                    <div className="audio-dynamics-live" title="Live gain reduction from the current playback route">
                      <span>GR</span>
                      <strong>
                        {dynamicsView.liveGainReductionDb !== undefined
                          ? `${dynamicsView.liveGainReductionDb.toFixed(1)} dB`
                          : '--'}
                      </strong>
                      <i style={{ transform: `scaleX(${Math.min(1, (dynamicsView.liveGainReductionDb ?? 0) / 24)})` }} />
                    </div>
                  </div>
                )}

                {descriptor.id === 'audio-math' ? <ResolveInspectorRow label="Sample graph">
                  {keyframeClipId && <ResolveInspectorIconButton className="resolve-inspector-text-button" ariaLabel="Open audio math nodes" onClick={event => {
                    if (event.detail > 0) event.currentTarget.blur();
                    requestNodeWorkspaceView(keyframeClipId, 'general');
                    activatePanelType('node-workspace');
                  }}>Open Nodes</ResolveInspectorIconButton>}
                </ResolveInspectorRow> : isFlexEqualizer ? (
                  <FlexEqualizerControl
                    params={effect.params}
                    compact={className?.includes('audio-effect-stack-compact') ?? false}
                    disabled={!enabled}
                    ariaLabel={`${descriptor.name} graph`}
                    analyzer={runtimeAnalyzer}
                    runtimeAnalyzerScope={runtimeAnalyzerScope}
                    runtimeAnalyzerTrackId={runtimeAnalyzerTrackId}
                    keyframeClipId={keyframeClipId}
                    effectId={effect.id}
                    onUpdateParamPath={(path, value) => onUpdateEffect(effect, path, value)}
                    onChangeParams={(params) => onUpdateEffect(effect, 'eq', params as unknown as AudioEffectParamValue)}
                  />
                ) : (
                  <div className="audio-effect-param-grid">
                    {descriptor.paramNames.map(paramName => {
                      const param = descriptor.params[paramName];
                      const currentValue = getAudioEffectValue(effect, paramName, param.default);
                      if (typeof param.default === 'boolean') {
                        return (
                          <ResolveInspectorRow key={paramName} label={formatParamLabel(paramName)}>
                            <input
                              type="checkbox" aria-label={formatParamLabel(paramName)}
                              checked={Boolean(currentValue)}
                              onChange={(e) => {
                                onUpdateEffect(effect, paramName, e.target.checked);
                                trackAudioEffectControl(descriptor.id, paramName, 'checkbox', 'click', 'change');
                              }}
                            />
                          </ResolveInspectorRow>
                        );
                      }
                      if (typeof param.default === 'string' && param.options?.length) {
                        return (
                          <ResolveInspectorRow key={paramName} label={formatParamLabel(paramName)}>
                            <InspectorSelect ariaLabel={formatParamLabel(paramName)}
                              value={typeof currentValue === 'string' ? currentValue : param.default}
                              options={param.options.map(option => ({ value: option, label: formatParamLabel(option) }))}
                              onChange={(value) => {
                                onUpdateEffect(effect, paramName, value);
                                trackAudioEffectControl(descriptor.id, paramName, 'select', 'select', 'change');
                              }} />
                          </ResolveInspectorRow>
                        );
                      }
                      if (typeof param.default === 'number') {
                        const numericValue = typeof currentValue === 'number' ? currentValue : param.default;
                        const meta = getParamControlMeta(paramName, param.default);
                        return (
                          <ResolveInspectorNumberRow key={paramName} label={formatParamLabel(paramName)}
                            value={numericValue} onChange={(value) => onUpdateEffect(effect, paramName, value)}
                            defaultValue={param.default} min={meta.min} max={meta.max}
                            hardMin={meta.min} hardMax={meta.max} step={10 ** -meta.decimals}
                            decimals={meta.decimals} suffix={meta.suffix} sensitivity={meta.sensitivity}
                            persistenceKey={`audio.effect.${effect.id}.${paramName}`}
                            keyframeToggle={keyframeClipId ? <EffectKeyframeToggle clipId={keyframeClipId}
                              effectId={effect.id} paramName={paramName} value={numericValue} /> : undefined}
                            onDragStart={() => startBatch('Adjust audio effect')} onDragEnd={() => endBatch()}
                            onCommit={(method) => trackAudioEffectControl(descriptor.id, paramName, 'number', method,
                              method === 'reset' ? 'reset' : 'change')}
                          />
                        );
                      }
                      return (
                        <ResolveInspectorRow key={paramName} label={formatParamLabel(paramName)}>
                          <input
                            type="text" className="resolve-inspector-text-input" aria-label={formatParamLabel(paramName)}
                            value={String(currentValue)}
                            onFocus={() => startBatch('Adjust audio effect')}
                            onChange={(e) => onUpdateEffect(effect, paramName, e.target.value)}
                            onBlur={() => {
                              endBatch();
                              trackAudioEffectControl(descriptor.id, paramName, 'number', 'type', 'change');
                            }}
                          />
                        </ResolveInspectorRow>
                      );
                    })}
                  </div>
                )}
              </EffectCard>
            );
          })}
        </div>
      )}
    </div>
  );
}
