import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import {
  getAllTransitions,
  getDefaultTransitionParams,
  getTransition,
  getTransitionParamValue,
  type TransitionParamValue,
  type TransitionType,
} from '../../../transitions';
import { DEFAULT_TRANSITION_PLACEMENT, planTransition } from '../../../stores/timeline/editOperations/transitionPlanner';
import { createTransitionMediaDurationResolver } from '../../../stores/timeline/editOperations/transitionMediaDurationResolver';
import type { TimelineClip } from '../../../types';

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
  const definition = transition ? getTransition(transition.type as TransitionType) : null;
  const availableTransitions = useMemo(() => {
    const allTransitions = getAllTransitions();
    if (isAudioClip(clip) || isAudioClip(linkedClip)) {
      return allTransitions.filter(candidate => candidate.id === 'crossfade');
    }
    return allTransitions;
  }, [clip, linkedClip]);
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

    const nextDefinition = getTransition(nextType as TransitionType);
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
  const params = definition.params
    ? Object.entries(definition.params).filter(([paramId]) => !(isAudioOnlyTransition && paramId === 'includeAudio'))
    : [];

  return (
    <div className="transition-properties-tab">
      <section className="properties-section">
        <h4>{definition.name}</h4>
        <div className="control-row">
          <label className="prop-label" htmlFor="transition-type-select">Effect</label>
          <select
            id="transition-type-select"
            value={transition.type}
            onChange={(event) => updateTransitionType(event.currentTarget.value)}
          >
            {availableTransitions.map(candidate => (
              <option key={candidate.id} value={candidate.id}>{candidate.name}</option>
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
