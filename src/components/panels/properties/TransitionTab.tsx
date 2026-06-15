import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  DIP_TRANSITION_GROUP,
  DIP_TRANSITION_OPTION_LABELS,
  DISSOLVE_TRANSITION_GROUP,
  DISSOLVE_TRANSITION_OPTION_LABELS,
  DISSOLVE_TRANSITION_OPTIONS,
  GLITCH_TRANSITION_GROUP,
  GLITCH_TRANSITION_OPTION_LABELS,
  GLITCH_TRANSITION_OPTIONS,
  IRIS_TRANSITION_GROUP,
  IRIS_TRANSITION_OPTION_LABELS,
  IRIS_TRANSITION_OPTIONS,
  LIGHT_TRANSITION_GROUP,
  LIGHT_TRANSITION_OPTION_LABELS,
  LIGHT_TRANSITION_OPTIONS,
  MOTION_BLUR_TRANSITION_GROUP,
  MOTION_BLUR_TRANSITION_OPTION_LABELS,
  MOTION_BLUR_TRANSITION_OPTIONS,
  PATTERN_TRANSITION_GROUP,
  PATTERN_TRANSITION_OPTION_LABELS,
  PATTERN_TRANSITION_OPTIONS,
  ROTATE_TRANSITION_GROUP,
  ROTATE_TRANSITION_OPTION_LABELS,
  ROTATE_TRANSITION_OPTIONS,
  STYLIZE_TRANSITION_GROUP,
  STYLIZE_TRANSITION_OPTION_LABELS,
  STYLIZE_TRANSITION_OPTIONS,
  TRANSITION_DIRECTIONS,
  TRANSITION_DIRECTION_LABELS,
  THREE_D_TRANSITION_OPTION_LABELS,
  WIPE_TRANSITION_GROUP,
  WIPE_TRANSITION_OPTION_LABELS,
  WIPE_TRANSITION_OPTIONS,
  ZOOM_TRANSITION_GROUP,
  ZOOM_TRANSITION_OPTION_LABELS,
  ZOOM_TRANSITION_OPTIONS,
  getAllTransitions,
  getDissolveTransitionOption,
  getDipTransitionOption,
  getDefaultTransitionParams,
  getDirectionalTransitionGroup,
  getGlitchTransitionOption,
  getIrisTransitionOption,
  getLightTransitionOption,
  getMotionBlurTransitionOption,
  getPatternTransitionOption,
  getRotateTransitionOption,
  getRuntimeTransition,
  getStylizeTransitionOption,
  getThreeDTransitionGroup,
  getThreeDTransitionOption,
  getTransitionFamilyById,
  getTransitionFamilyGroup,
  getTransitionDirection,
  getTransitionParamValue,
  getWipeTransitionOption,
  getZoomTransitionOption,
  type TransitionType,
  type TransitionParamValue,
  type ThreeDTransitionOption,
} from '../../../transitions';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../../stores/timeline/editOperations/transitionPlanner';
import { createTransitionMediaDurationResolver } from '../../../stores/timeline/editOperations/transitionMediaDurationResolver';
import type { TimelineClip } from '../../../types';
import {
  DIP_OPTIONS,
  DIP_SWATCHES,
  getDissolveGlyphClass,
  getGlitchGlyphClass,
  getLightGlyphClass,
  getMotionBlurGlyphClass,
  getPatternGlyphClass,
  getRotateGlyphClass,
  getStylizeGlyphClass,
  getThreeDGlyphClass,
  getTransitionSelectOptionGroups,
  getZoomGlyphClass,
  isDirectionOption,
} from './transitionChoiceMetadata';

interface TransitionTabProps {
  clip: TimelineClip;
  edge: 'in' | 'out';
  transitionId: string;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

function isAudioClip(clip: TimelineClip | null): boolean {
  return clip?.source?.type === 'audio' || clip?.file?.type?.startsWith('audio/') === true;
}

export function TransitionTab({ clip, edge, transitionId }: TransitionTabProps) {
  const clips = useTimelineStore(state => state.clips);
  const transitionEditPreview = useTimelineStore(state => state.transitionEditPreview);
  const applyTimelineEditOperation = useTimelineStore(state => state.applyTimelineEditOperation);
  const clearPropertiesSelection = useTimelineStore(state => state.clearPropertiesSelection);
  const mediaFiles = useMediaStore(state => state.files);
  const getMediaDuration = useMemo(() => createTransitionMediaDurationResolver(mediaFiles), [mediaFiles]);
  const transition = edge === 'in' ? clip.transitionIn : clip.transitionOut;
  const linkedClip = transition
    ? clips.find(candidate => candidate.id === transition.linkedClipId) ?? null
    : null;
  const definition = transition ? getRuntimeTransition(transition.type) : null;
  const availableTransitions = useMemo(() => {
    const allTransitions = getAllTransitions();
    if (isAudioClip(clip) || isAudioClip(linkedClip)) {
      return allTransitions.filter(candidate => candidate.id === 'crossfade');
    }
    return allTransitions;
  }, [clip, linkedClip]);
  const availableTransitionOptionGroups = useMemo(
    () => getTransitionSelectOptionGroups(availableTransitions),
    [availableTransitions]
  );
  const activeEditPreview = transitionEditPreview?.transitionId === transition?.id
    ? transitionEditPreview
    : null;
  const displayDuration = activeEditPreview?.duration ?? transition?.duration ?? 0;
  const displayOffset = activeEditPreview?.offset ?? transition?.offset ?? 0;

  const outgoingClip = edge === 'out' ? clip : linkedClip;
  const incomingClip = edge === 'out' ? linkedClip : clip;
  const plan = useMemo(() => {
    if (!transition || !outgoingClip || !incomingClip) return null;
    return planTransition({
      outgoingClip,
      incomingClip,
      transitionType: transition.type,
      requestedDuration: displayDuration,
      params: transition.params,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      junctionTime: outgoingClip.startTime + outgoingClip.duration,
      bodyOffset: displayOffset,
      getMediaDuration,
    });
  }, [displayDuration, displayOffset, getMediaDuration, incomingClip, outgoingClip, transition]);

  const updateDuration = useCallback((nextDuration: number) => {
    if (!transition || !Number.isFinite(nextDuration) || nextDuration <= 0) return;

    const operationId = `transition-duration:${transition.id}:${Date.now()}`;
    applyTimelineEditOperation({
      id: operationId,
      type: 'transition-update-duration',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'ui',
      clipId: clip.id,
      edge,
      transitionId,
      requestedDuration: nextDuration,
    }, {
      source: 'ui',
      historyLabel: 'Update transition duration',
    });
  }, [applyTimelineEditOperation, clip.id, edge, transition, transitionId]);

  const updateTransitionType = useCallback((nextType: string) => {
    if (!transition || nextType === transition.type) return;

    const nextDefinition = getRuntimeTransition(nextType);
    if (!nextDefinition) return;

    const operationId = `transition-type:${transition.id}:${Date.now()}`;
    applyTimelineEditOperation({
      id: operationId,
      type: 'transition-update-type',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'ui',
      clipId: clip.id,
      edge,
      transitionId,
      transitionType: nextDefinition.id,
      params: getDefaultTransitionParams(nextDefinition),
    }, {
      source: 'ui',
      historyLabel: 'Change transition type',
    });
  }, [applyTimelineEditOperation, clip.id, edge, transition, transitionId]);

  const updateTransitionFamily = useCallback((nextValue: string) => {
    if (!transition) return;

    const family = getTransitionFamilyById(nextValue);
    const nextType = family
      ? (family.types.includes(transition.type as TransitionType) ? transition.type : family.defaultType)
      : nextValue;
    updateTransitionType(nextType);
  }, [transition, updateTransitionType]);

  const updateParam = useCallback((paramId: string, value: TransitionParamValue) => {
    if (!transition) return;

    const operationId = `transition-params:${transition.id}:${Date.now()}`;
    applyTimelineEditOperation({
      id: operationId,
      type: 'transition-update-params',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'ui',
      clipId: clip.id,
      edge,
      transitionId,
      params: {
        ...(transition.params ?? {}),
        [paramId]: value,
      },
    }, {
      source: 'ui',
      historyLabel: 'Update transition parameters',
    });
  }, [applyTimelineEditOperation, clip.id, edge, transition, transitionId]);

  const removeTransition = useCallback(() => {
    if (!transition) return;

    const operationId = `transition-remove:${transition.id}:${Date.now()}`;
    const result = applyTimelineEditOperation({
      id: operationId,
      type: 'transition-remove',
      transactionId: operationId,
      historyBatchId: operationId,
      source: 'ui',
      clipId: clip.id,
      edge,
      transitionId,
    }, {
      source: 'ui',
      historyLabel: 'Remove transition',
    });
    if (result.success) {
      clearPropertiesSelection();
    }
  }, [applyTimelineEditOperation, clearPropertiesSelection, clip.id, edge, transition, transitionId]);

  if (!transition || transition.id !== transitionId || !definition || !linkedClip || !plan) {
    return (
      <div className="panel-empty">
        <p>Select an active transition to edit its parameters.</p>
      </div>
    );
  }

  const duration = plan.resolvedDuration;
  const holdDuration = plan.outgoing.holdDuration + plan.incoming.holdDuration;
  const realHandleDuration = plan.outgoing.realHandleDuration + plan.incoming.realHandleDuration;
  const isAudioOnlyTransition = isAudioClip(clip) || isAudioClip(linkedClip);
  const dissolveOption = getDissolveTransitionOption(transition.type);
  const directionalGroup = getDirectionalTransitionGroup(transition.type);
  const activeDirection = getTransitionDirection(transition.type);
  const dipOption = getDipTransitionOption(transition.type);
  const wipeOption = getWipeTransitionOption(transition.type);
  const irisOption = getIrisTransitionOption(transition.type);
  const lightOption = getLightTransitionOption(transition.type);
  const motionBlurOption = getMotionBlurTransitionOption(transition.type);
  const glitchOption = getGlitchTransitionOption(transition.type);
  const patternOption = getPatternTransitionOption(transition.type);
  const stylizeOption = getStylizeTransitionOption(transition.type);
  const rotateOption = getRotateTransitionOption(transition.type);
  const threeDOption = getThreeDTransitionOption(transition.type);
  const threeDGroup = getThreeDTransitionGroup(transition.type);
  const zoomOption = getZoomTransitionOption(transition.type);
  const activeTransitionOption = getTransitionFamilyGroup(transition.type)?.id ?? transition.type;
  const handledParamIds = new Set<string>();
  if (dipOption === 'custom') {
    handledParamIds.add('color');
  }
  const dipColorValue = dipOption === 'custom'
    ? String(getTransitionParamValue(transition, definition, 'color') ?? '#000000')
    : '#000000';
  const params = definition.params
    ? Object.entries(definition.params)
      .filter(([paramId]) => !(isAudioOnlyTransition && paramId === 'includeAudio'))
      .filter(([paramId]) => !handledParamIds.has(paramId))
    : [];

  return (
    <div className="transition-properties-tab">
      <section className="properties-section">
        <h4>{definition.name}</h4>
        <div className="control-row">
          <label className="prop-label" htmlFor="transition-type-select">Effect</label>
          <select
            id="transition-type-select"
            value={activeTransitionOption}
            onChange={(event) => updateTransitionFamily(event.currentTarget.value)}
          >
            {availableTransitionOptionGroups.map(group => (
              <optgroup key={group.dimension} label={group.label}>
                {group.options.map(candidate => (
                  <option key={candidate.value} value={candidate.value}>{candidate.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="control-row">
          <span className="prop-label">Type</span>
          <span className="transition-static-value">{definition.category}</span>
        </div>
        <div className="control-row">
          <span className="prop-label">Edge</span>
          <span className="transition-static-value">Centered on cut</span>
        </div>
        <div className="control-row">
          <span className="prop-label">Policy</span>
          <span className="transition-static-value">Hold frames</span>
        </div>
      </section>

      {dissolveOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{DISSOLVE_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-dissolve-grid">
            {(isAudioOnlyTransition ? ['crossfade'] as const : DISSOLVE_TRANSITION_OPTIONS).map((option) => {
              const nextType = DISSOLVE_TRANSITION_GROUP.transitions[option];
              const isActive = option === dissolveOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-dissolve-glyph ${getDissolveGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{DISSOLVE_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {wipeOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{WIPE_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-wipe-grid">
            {WIPE_TRANSITION_OPTIONS.map((option) => {
              const nextType = WIPE_TRANSITION_GROUP.transitions[option];
              const isActive = option === wipeOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span
                    className={isDirectionOption(option)
                      ? `transition-direction-glyph transition-direction-glyph-${option}`
                      : `transition-wipe-glyph transition-wipe-glyph-${option}`}
                    aria-hidden="true"
                  />
                  <span className="transition-choice-label">{WIPE_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {directionalGroup && activeDirection ? (
        <section className="properties-section transition-choice-section">
          <h4>{directionalGroup.label} Direction</h4>
          <div className="transition-choice-grid">
            {TRANSITION_DIRECTIONS.map((direction) => {
              const nextType = directionalGroup.transitions[direction];
              const isActive = direction === activeDirection;
              return (
                <button
                  key={direction}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span
                    className={`transition-direction-glyph transition-direction-glyph-${direction}`}
                    aria-hidden="true"
                  />
                  <span className="transition-choice-label">{TRANSITION_DIRECTION_LABELS[direction]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {irisOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{IRIS_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-iris-grid">
            {IRIS_TRANSITION_OPTIONS.map((option) => {
              const nextType = IRIS_TRANSITION_GROUP.transitions[option];
              const isActive = option === irisOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-iris-glyph transition-iris-glyph-${option}`} aria-hidden="true" />
                  <span className="transition-choice-label">{IRIS_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {threeDGroup && threeDOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{threeDGroup.label}</h4>
          <div className="transition-choice-grid transition-three-d-grid">
            {(Object.entries(threeDGroup.transitions) as [ThreeDTransitionOption, TransitionType][]).map(([option, nextType]) => {
              const isActive = option === threeDOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-three-d-glyph ${getThreeDGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{THREE_D_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {lightOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{LIGHT_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-light-grid">
            {LIGHT_TRANSITION_OPTIONS.map((option) => {
              const nextType = LIGHT_TRANSITION_GROUP.transitions[option];
              const isActive = option === lightOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-light-glyph ${getLightGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{LIGHT_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {motionBlurOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{MOTION_BLUR_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-motion-blur-grid">
            {MOTION_BLUR_TRANSITION_OPTIONS.map((option) => {
              const nextType = MOTION_BLUR_TRANSITION_GROUP.transitions[option];
              const isActive = option === motionBlurOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-motion-blur-glyph ${getMotionBlurGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{MOTION_BLUR_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {glitchOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{GLITCH_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-glitch-grid">
            {GLITCH_TRANSITION_OPTIONS.map((option) => {
              const nextType = GLITCH_TRANSITION_GROUP.transitions[option];
              const isActive = option === glitchOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-glitch-glyph ${getGlitchGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{GLITCH_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {patternOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{PATTERN_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-pattern-grid">
            {PATTERN_TRANSITION_OPTIONS.map((option) => {
              const nextType = PATTERN_TRANSITION_GROUP.transitions[option];
              const isActive = option === patternOption;
              const isRuntimeOption = Boolean(getRuntimeTransition(nextType));
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  aria-disabled={!isRuntimeOption}
                  disabled={!isRuntimeOption}
                  onClick={() => {
                    if (isRuntimeOption) updateTransitionType(nextType);
                  }}
                >
                  <span className={`transition-pattern-glyph ${getPatternGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{PATTERN_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {zoomOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{ZOOM_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-zoom-grid">
            {ZOOM_TRANSITION_OPTIONS.map((option) => {
              const nextType = ZOOM_TRANSITION_GROUP.transitions[option];
              const isActive = option === zoomOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-zoom-glyph ${getZoomGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{ZOOM_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {stylizeOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{STYLIZE_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-stylize-grid">
            {STYLIZE_TRANSITION_OPTIONS.map((option) => {
              const nextType = STYLIZE_TRANSITION_GROUP.transitions[option];
              const isActive = option === stylizeOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-stylize-glyph ${getStylizeGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{STYLIZE_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {rotateOption ? (
        <section className="properties-section transition-choice-section">
          <h4>{ROTATE_TRANSITION_GROUP.label}</h4>
          <div className="transition-choice-grid transition-stylize-grid">
            {ROTATE_TRANSITION_OPTIONS.map((option) => {
              const nextType = ROTATE_TRANSITION_GROUP.transitions[option];
              const isActive = option === rotateOption;
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span className={`transition-stylize-glyph ${getRotateGlyphClass(option)}`} aria-hidden="true" />
                  <span className="transition-choice-label">{ROTATE_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
        </section>
      ) : null}

      {dipOption ? (
        <section className="properties-section transition-choice-section">
          <h4>Dip Color</h4>
          <div className="transition-choice-grid transition-dip-grid">
            {DIP_OPTIONS.map((option) => {
              const nextType = DIP_TRANSITION_GROUP.transitions[option];
              const isActive = option === dipOption;
              const swatch = option === 'custom' ? dipColorValue : DIP_SWATCHES[option];
              return (
                <button
                  key={option}
                  type="button"
                  className={`transition-choice-button transition-color-choice ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => updateTransitionType(nextType)}
                >
                  <span
                    className={`transition-color-chip transition-color-chip-${option}`}
                    style={{ backgroundColor: swatch }}
                    aria-hidden="true"
                  />
                  <span className="transition-choice-label">{DIP_TRANSITION_OPTION_LABELS[option]}</span>
                </button>
              );
            })}
          </div>
          {dipOption === 'custom' ? (
            <label className="transition-color-picker" htmlFor="transition-dip-color-input">
              <span
                className="transition-color-preview"
                style={{ backgroundColor: dipColorValue }}
                aria-hidden="true"
              />
              <span className="transition-color-picker-label">Color</span>
              <input
                id="transition-dip-color-input"
                type="color"
                value={dipColorValue}
                onChange={(event) => updateParam('color', event.currentTarget.value)}
              />
            </label>
          ) : null}
        </section>
      ) : null}

      <section className="properties-section">
        <h4>Timing</h4>
        <div className="control-row transition-duration-row">
          <label className="prop-label" htmlFor="transition-duration-input">Duration</label>
          <input
            id="transition-duration-input"
            type="number"
            min={definition.minDuration}
            step={0.05}
            value={Number(duration.toFixed(3))}
            onChange={(event) => updateDuration(Number(event.currentTarget.value))}
          />
          <span className="transition-static-value">{formatSeconds(plan.bodyStart)} - {formatSeconds(plan.bodyEnd)}</span>
        </div>
      </section>

      <section className="properties-section">
        <h4>Source Handles</h4>
        <div className="control-row">
          <span className="prop-label">Real</span>
          <span className="transition-static-value">{formatSeconds(realHandleDuration)}</span>
        </div>
        <div className="control-row">
          <span className="prop-label">Hold</span>
          <span className={holdDuration > 0 ? 'transition-hold-value' : 'transition-static-value'}>
            {formatSeconds(holdDuration)}
          </span>
        </div>
      </section>

      <section className="properties-section">
        <h4>Parameters</h4>
        {params.length === 0 ? (
          <div className="transition-static-value">No additional parameters</div>
        ) : params.map(([paramId, param]) => {
          const value = getTransitionParamValue(transition, definition, paramId);
          if (param.type === 'boolean') {
            return (
              <label className="control-row transition-param-row transition-checkbox-row" key={paramId}>
                <span className="prop-label">{param.label}</span>
                <input
                  type="checkbox"
                  checked={value === true}
                  onChange={(event) => updateParam(paramId, event.currentTarget.checked)}
                />
              </label>
            );
          }
          if (param.type === 'number') {
            return (
              <div className="control-row transition-param-row" key={paramId}>
                <label className="prop-label" htmlFor={`transition-param-${paramId}`}>{param.label}</label>
                <input
                  id={`transition-param-${paramId}`}
                  type="number"
                  min={param.min}
                  max={param.max}
                  step={param.step ?? 0.01}
                  value={typeof value === 'number' ? value : Number(param.defaultValue)}
                  onChange={(event) => updateParam(paramId, Number(event.currentTarget.value))}
                />
              </div>
            );
          }
          if (param.type === 'select') {
            return (
              <div className="control-row transition-param-row" key={paramId}>
                <label className="prop-label" htmlFor={`transition-param-${paramId}`}>{param.label}</label>
                <select
                  id={`transition-param-${paramId}`}
                  value={String(value ?? param.defaultValue)}
                  onChange={(event) => updateParam(paramId, event.currentTarget.value)}
                >
                  {(param.options ?? []).map(option => (
                    <option key={String(option.value)} value={String(option.value)}>{option.label}</option>
                  ))}
                </select>
              </div>
            );
          }
          return (
            <div className="control-row transition-param-row" key={paramId}>
              <label className="prop-label" htmlFor={`transition-param-${paramId}`}>{param.label}</label>
              <input
                id={`transition-param-${paramId}`}
                type={param.type === 'color' ? 'color' : 'text'}
                value={String(value ?? param.defaultValue)}
                onChange={(event) => updateParam(paramId, event.currentTarget.value)}
              />
            </div>
          );
        })}
      </section>

      <button className="transition-remove-button" type="button" onClick={removeTransition}>
        Remove Transition
      </button>
    </div>
  );
}
