import { useCallback, useEffect, useState, type KeyboardEvent } from 'react';
import type { AnimatableProperty, Keyframe } from '../../../types';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
  coerceVectorAnimationInputValue,
  createVectorAnimationInputProperty,
  createVectorAnimationStateProperty,
  getVectorAnimationInputNumericValue,
  getVectorAnimationStateIndex,
  normalizeVectorAnimationRenderDimension,
  normalizeVectorAnimationStateCues,
  normalizeVectorAnimationStateName,
  vectorAnimationInputValueToNumber,
  type VectorAnimationPlaybackMode,
  type VectorAnimationClipSettings,
  type VectorAnimationStateMachineInput,
  type VectorAnimationStateMachineInputValue,
} from '../../../types/vectorAnimation';
import { DraggableNumber, KeyframeToggle } from './shared';

interface LottieTabProps {
  clipId: string;
}

type ResolutionDraft = {
  sourceKey: string;
  width: string;
  height: string;
};

const EMPTY_STATE_NAMES: string[] = [];
const EMPTY_STATE_MACHINE_INPUTS: VectorAnimationStateMachineInput[] = [];

function cleanBackgroundColor(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

function formatInputType(input: VectorAnimationStateMachineInput): string {
  if (input.type === 'boolean') return 'Bool';
  if (input.type === 'number') return 'Number';
  if (input.type === 'string') return 'Text';
  return 'Trigger';
}

function formatDimensionValue(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}

export function LottieTab({ clipId }: LottieTabProps) {
  const clip = useTimelineStore((state) => state.clips.find((current) => current.id === clipId));
  const playheadPosition = useTimelineStore((state) => state.playheadPosition);
  const clipKeyframes = useTimelineStore((state) => state.clipKeyframes);
  const setPropertyValue = useTimelineStore((state) => state.setPropertyValue);
  const addKeyframe = useTimelineStore((state) => state.addKeyframe);
  const updateKeyframe = useTimelineStore((state) => state.updateKeyframe);
  const removeKeyframe = useTimelineStore((state) => state.removeKeyframe);
  const getInterpolatedVectorAnimationSettings = useTimelineStore((state) => state.getInterpolatedVectorAnimationSettings);
  const files = useMediaStore((state) => state.files);
  const [resolutionLinked, setResolutionLinked] = useState(true);

  const mediaFile = clip?.source?.mediaFileId
    ? files.find((file) => file.id === clip.source?.mediaFileId)
    : undefined;
  const metadata = mediaFile?.vectorAnimation;
  const settings: VectorAnimationClipSettings = {
    ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
    ...clip?.source?.vectorAnimationSettings,
  };
  const animationNames = metadata?.animationNames ?? [];
  const stateMachineNames = metadata?.stateMachineNames ?? [];
  const selectedStateMachineName = settings.stateMachineName ?? '';
  const stateMachineStateNames = selectedStateMachineName
    ? metadata?.stateMachineStates?.[selectedStateMachineName] ?? EMPTY_STATE_NAMES
    : EMPTY_STATE_NAMES;
  const stateMachineInputs = selectedStateMachineName
    ? metadata?.stateMachineInputs?.[selectedStateMachineName] ?? EMPTY_STATE_MACHINE_INPUTS
    : EMPTY_STATE_MACHINE_INPUTS;
  const stateProperty = selectedStateMachineName
    ? createVectorAnimationStateProperty(selectedStateMachineName)
    : null;
  const stateKeyframes: Keyframe[] = stateProperty
    ? (clipKeyframes.get(clipId) ?? [])
      .filter((keyframe): keyframe is Keyframe => keyframe.property === stateProperty)
      .toSorted((a, b) => a.time - b.time)
    : [];
  const resolutionSourceWidth = formatDimensionValue(settings.renderWidth ?? metadata?.width);
  const resolutionSourceHeight = formatDimensionValue(settings.renderHeight ?? metadata?.height);
  const resolutionSourceKey = `${resolutionSourceWidth}:${resolutionSourceHeight}`;
  const [resolutionDraftState, setResolutionDraftState] = useState<ResolutionDraft>(() => ({
    sourceKey: resolutionSourceKey,
    width: resolutionSourceWidth,
    height: resolutionSourceHeight,
  }));
  const resolutionDraft: ResolutionDraft = resolutionDraftState.sourceKey === resolutionSourceKey
    ? resolutionDraftState
    : {
        sourceKey: resolutionSourceKey,
        width: resolutionSourceWidth,
        height: resolutionSourceHeight,
      };
  const clipLocalTime = clip
    ? Math.max(0, Math.min(playheadPosition - clip.startTime, clip.duration))
    : 0;
  const liveSettings = clip
    ? getInterpolatedVectorAnimationSettings(clipId, clipLocalTime)
    : settings;
  const currentStateName = liveSettings.stateMachineState ?? settings.stateMachineState ?? stateMachineStateNames[0] ?? '';
  const currentStateIndex = getVectorAnimationStateIndex(stateMachineStateNames, currentStateName);

  const updateSettings = useCallback((updates: Partial<VectorAnimationClipSettings>) => {
    const { clips } = useTimelineStore.getState();
    const current = clips.find((candidate) => candidate.id === clipId);
    if (!current?.source || current.source.type !== 'lottie') {
      return;
    }

    useTimelineStore.setState({
      clips: clips.map((candidate) =>
        candidate.id === clipId
          ? {
              ...candidate,
              source: {
                ...candidate.source!,
                vectorAnimationSettings: {
                  ...DEFAULT_VECTOR_ANIMATION_CLIP_SETTINGS,
                  ...candidate.source?.vectorAnimationSettings,
                  ...updates,
                },
              },
            }
          : candidate
      ),
    });
    useTimelineStore.getState().invalidateCache();
  }, [clipId]);

  useEffect(() => {
    if (
      !clip ||
      !stateProperty ||
      stateMachineStateNames.length === 0 ||
      !settings.stateMachineStateCues ||
      settings.stateMachineStateCues.length === 0
    ) {
      return;
    }

    normalizeVectorAnimationStateCues(settings.stateMachineStateCues).forEach((cue) => {
      addKeyframe(
        clipId,
        stateProperty as AnimatableProperty,
        getVectorAnimationStateIndex(stateMachineStateNames, cue.stateName),
        Math.max(0, Math.min(cue.time, clip.duration)),
        'linear',
      );
    });
    updateSettings({ stateMachineStateCues: undefined });
  }, [
    addKeyframe,
    clip,
    clipId,
    settings.stateMachineStateCues,
    stateMachineStateNames,
    stateProperty,
    updateSettings,
  ]);

  const setStateValue = (stateName: string) => {
    if (!stateProperty || stateMachineStateNames.length === 0) {
      updateSettings({ stateMachineState: normalizeVectorAnimationStateName(stateName), stateMachineStateCues: undefined });
      return;
    }

    setPropertyValue(
      clipId,
      stateProperty as AnimatableProperty,
      getVectorAnimationStateIndex(stateMachineStateNames, stateName),
    );
  };

  const addStateKeyframeAtPlayhead = () => {
    if (!clip || !stateProperty || stateMachineStateNames.length === 0) {
      return;
    }

    addKeyframe(
      clipId,
      stateProperty as AnimatableProperty,
      currentStateIndex,
      Math.max(0, Math.min(clipLocalTime, clip.duration)),
      'linear',
    );
  };

  const updateStateKeyframeValue = (keyframeId: string, stateName: string) => {
    updateKeyframe(keyframeId, {
      value: getVectorAnimationStateIndex(stateMachineStateNames, stateName),
    });
  };

  const updateStateKeyframeTime = (keyframeId: string, time: number) => {
    if (!clip) {
      return;
    }
    updateKeyframe(keyframeId, {
      time: Math.max(0, Math.min(time, clip.duration)),
    });
  };

  const getInputValue = (input: VectorAnimationStateMachineInput): VectorAnimationStateMachineInputValue => (
    coerceVectorAnimationInputValue(
      input,
      liveSettings.stateMachineInputValues?.[input.name] ?? settings.stateMachineInputValues?.[input.name],
    )
  );

  const updateInputValue = (
    input: VectorAnimationStateMachineInput,
    value: VectorAnimationStateMachineInputValue,
  ) => {
    if (!selectedStateMachineName || input.type === 'trigger') {
      return;
    }

    const property = createVectorAnimationInputProperty(selectedStateMachineName, input.name);
    if (input.type === 'string') {
      updateSettings({
        stateMachineInputValues: {
          ...(settings.stateMachineInputValues ?? {}),
          [input.name]: String(value),
        },
      });
      return;
    }

    setPropertyValue(
      clipId,
      property as AnimatableProperty,
      input.type === 'boolean' ? Number(Boolean(value)) : vectorAnimationInputValueToNumber(value),
    );
  };

  const commitRenderDimensions = (draft: Pick<ResolutionDraft, 'width' | 'height'> = resolutionDraft) => {
    const width = normalizeVectorAnimationRenderDimension(Number(draft.width));
    const height = normalizeVectorAnimationRenderDimension(Number(draft.height));
    updateSettings({ renderWidth: width, renderHeight: height });
  };

  const updateRenderDimensionDraft = (axis: 'width' | 'height', value: string) => {
    setResolutionDraftState((current) => {
      const base = current.sourceKey === resolutionSourceKey
        ? current
        : {
            sourceKey: resolutionSourceKey,
            width: resolutionSourceWidth,
            height: resolutionSourceHeight,
          };
      const next = resolutionLinked
        ? { ...base, width: value, height: value }
        : { ...base, [axis]: value };
      return next;
    });
  };

  const handleResolutionKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      commitRenderDimensions();
      event.currentTarget.blur();
    }
  };

  if (!clip || clip.source?.type !== 'lottie') {
    return null;
  }

  return (
    <div className="properties-tab-content lottie-tab">
      <div className="properties-section lottie-summary-section">
        <div className="lottie-summary">
          <div className="lottie-summary-text">
            <div className="lottie-title" title={clip.name}>{clip.name}</div>
            <div className="lottie-meta">
              {metadata?.width && metadata?.height ? `${metadata.width} x ${metadata.height}` : 'Canvas-backed animation'}
              {metadata?.fps ? ` - ${metadata.fps.toFixed(2)} fps` : ''}
            </div>
          </div>
          <label className="lottie-loop-toggle">
            <input
              type="checkbox"
              checked={settings.loop}
              onChange={(event) => updateSettings({ loop: event.target.checked })}
            />
            <span>Loop</span>
          </label>
        </div>
      </div>

      <div className="properties-section lottie-controls-section">
        <div className="lottie-field-row">
          <span className="lottie-field-label">Mode</span>
          <div className="lottie-segmented-control lottie-playback-mode">
            {[
              ['forward', 'Fwd'],
              ['reverse', 'Rev'],
              ['bounce', 'Bounce'],
              ['reverse-bounce', 'Rev Bounce'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.playbackMode === value ? 'active' : ''}
                onClick={() => updateSettings({ playbackMode: value as VectorAnimationPlaybackMode })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="lottie-field-row">
          <span className="lottie-field-label">End</span>
          <div className="lottie-segmented-control">
            {[
              ['hold', 'Hold'],
              ['clear', 'Clear'],
              ['loop', 'Loop'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.endBehavior === value ? 'active' : ''}
                onClick={() => updateSettings({ endBehavior: value as VectorAnimationClipSettings['endBehavior'] })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="lottie-field-row">
          <span className="lottie-field-label">Fit</span>
          <div className="lottie-segmented-control">
            {[
              ['contain', 'Contain'],
              ['cover', 'Cover'],
              ['fill', 'Fill'],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={settings.fit === value ? 'active' : ''}
                onClick={() => updateSettings({ fit: value as VectorAnimationClipSettings['fit'] })}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {animationNames.length > 0 && (
          <label className="lottie-field-row">
            <span className="lottie-field-label">Animation</span>
            <select
              className="lottie-select"
              value={settings.animationName ?? metadata?.defaultAnimationName ?? animationNames[0]}
              onChange={(event) => updateSettings({ animationName: event.target.value || undefined })}
            >
              {animationNames.map((animationName) => (
                <option key={animationName} value={animationName}>
                  {animationName}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="lottie-field-row">
          <span className="lottie-field-label">Resolution</span>
          <div className="lottie-resolution-row">
            <input
              className="lottie-input lottie-resolution-input"
              type="number"
              min={16}
              max={8192}
              step={1}
              value={resolutionDraft.width}
              onChange={(event) => updateRenderDimensionDraft('width', event.target.value)}
              onBlur={() => commitRenderDimensions()}
              onKeyDown={handleResolutionKeyDown}
            />
            <span>x</span>
            <input
              className="lottie-input lottie-resolution-input"
              type="number"
              min={16}
              max={8192}
              step={1}
              value={resolutionDraft.height}
              onChange={(event) => updateRenderDimensionDraft('height', event.target.value)}
              onBlur={() => commitRenderDimensions()}
              onKeyDown={handleResolutionKeyDown}
            />
            <button
              type="button"
              className={`lottie-link-toggle ${resolutionLinked ? 'active' : ''}`}
              onClick={() => setResolutionLinked((linked) => !linked)}
              title={resolutionLinked ? 'Unlink resolution' : 'Link resolution'}
            >
              1:1
            </button>
            <button
              type="button"
              className="btn btn-xs"
              onClick={() => {
                const width = formatDimensionValue(metadata?.width);
                const height = formatDimensionValue(metadata?.height);
                setResolutionDraftState({ sourceKey: `${width}:${height}`, width, height });
                updateSettings({ renderWidth: undefined, renderHeight: undefined });
              }}
            >
              Original
            </button>
          </div>
        </div>
      </div>

      {stateMachineNames.length > 0 && (
        <div className="properties-section lottie-state-section">
          <h4>State Machine</h4>

          <label className="lottie-field-row">
            <span className="lottie-field-label">Machine</span>
            <select
              className="lottie-select"
              value={selectedStateMachineName}
              onChange={(event) => updateSettings({
                stateMachineName: event.target.value || undefined,
                stateMachineState: undefined,
                stateMachineStateCues: undefined,
                stateMachineInputValues: undefined,
              })}
            >
              <option value="">None</option>
              {stateMachineNames.map((stateMachineName) => (
                <option key={stateMachineName} value={stateMachineName}>
                  {stateMachineName}
                </option>
              ))}
            </select>
          </label>

          {selectedStateMachineName && (
            <>
              <label className="lottie-field-row">
                <span className="lottie-field-label">State</span>
                {stateMachineStateNames.length > 0 && stateProperty ? (
                  <div className="lottie-state-control">
                    <KeyframeToggle
                      clipId={clipId}
                      property={stateProperty as AnimatableProperty}
                      value={currentStateIndex}
                    />
                    <select
                      className="lottie-select"
                      value={currentStateName || stateMachineStateNames[0] || ''}
                      onChange={(event) => setStateValue(event.target.value)}
                    >
                      {stateMachineStateNames.map((stateName) => (
                        <option key={stateName} value={stateName}>
                          {stateName}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <input
                    className="lottie-input"
                    type="text"
                    value={settings.stateMachineState ?? ''}
                    onChange={(event) => updateSettings({ stateMachineState: normalizeVectorAnimationStateName(event.target.value) })}
                    placeholder="Initial"
                  />
                )}
              </label>

              {stateMachineInputs.length > 0 && (
                <div className="lottie-input-list">
                  <div className="lottie-subsection-title">Inputs</div>
                  {stateMachineInputs.map((input) => {
                    const property = createVectorAnimationInputProperty(selectedStateMachineName, input.name);
                    const value = getInputValue(input);
                    const numericValue = getVectorAnimationInputNumericValue(liveSettings, input);
                    const isBooleanOn = Boolean(value);
                    const hasKeyframesForInput = (clipKeyframes.get(clipId) ?? []).some((keyframe) => keyframe.property === property);

                    return (
                      <div key={input.name} className={`lottie-input-row ${hasKeyframesForInput ? 'has-keyframes' : ''}`}>
                        <div className="lottie-input-label">
                          <span title={input.name}>{input.name}</span>
                          <span>{formatInputType(input)}</span>
                        </div>

                        {input.type !== 'string' && input.type !== 'trigger' && (
                          <KeyframeToggle
                            clipId={clipId}
                            property={property as AnimatableProperty}
                            value={numericValue}
                          />
                        )}

                        {input.type === 'boolean' && (
                          <div className="lottie-boolean-control">
                            <button
                              type="button"
                              className={!isBooleanOn ? 'active' : ''}
                              onClick={() => updateInputValue(input, false)}
                            >
                              Off
                            </button>
                            <button
                              type="button"
                              className={isBooleanOn ? 'active' : ''}
                              onClick={() => updateInputValue(input, true)}
                            >
                              On
                            </button>
                          </div>
                        )}

                        {input.type === 'number' && (
                          <DraggableNumber
                            value={numericValue}
                            onChange={(nextValue) => updateInputValue(input, nextValue)}
                            defaultValue={vectorAnimationInputValueToNumber(input.defaultValue)}
                            decimals={2}
                            sensitivity={20}
                          />
                        )}

                        {input.type === 'string' && (
                          <input
                            className="lottie-input lottie-input-static"
                            type="text"
                            value={String(value)}
                            onChange={(event) => updateInputValue(input, event.target.value)}
                          />
                        )}

                        {input.type === 'trigger' && (
                          <span className="lottie-input-note">Trigger</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {stateMachineStateNames.length > 0 && stateProperty && (
                <div className="lottie-cue-panel">
                  <button
                    type="button"
                    className="btn btn-xs lottie-cue-add-btn"
                    onClick={addStateKeyframeAtPlayhead}
                    disabled={!currentStateName}
                  >
                    Add State Keyframe at {formatSeconds(clipLocalTime)}
                  </button>

                  {stateKeyframes.length > 0 && (
                    <div className="lottie-cue-list">
                      {stateKeyframes.map((keyframe) => {
                        const stateName = stateMachineStateNames[
                          Math.max(0, Math.min(stateMachineStateNames.length - 1, Math.round(keyframe.value)))
                        ] ?? '';

                        return (
                          <div key={keyframe.id} className="lottie-cue-row">
                            <input
                              className="lottie-input lottie-time-input"
                              type="number"
                              min={0}
                              max={clip.duration}
                              step={0.01}
                              value={Number(keyframe.time.toFixed(3))}
                              onChange={(event) => updateStateKeyframeTime(keyframe.id, Number(event.target.value))}
                            />
                            <select
                              className="lottie-select"
                              value={stateName}
                              onChange={(event) => updateStateKeyframeValue(keyframe.id, event.target.value)}
                            >
                              {stateMachineStateNames.map((candidateStateName) => (
                                <option key={candidateStateName} value={candidateStateName}>
                                  {candidateStateName}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              className="lottie-cue-remove"
                              onClick={() => removeKeyframe(keyframe.id)}
                              aria-label={`Remove ${stateName} state keyframe`}
                              title="Remove state keyframe"
                            >
                              x
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="properties-section lottie-controls-section">
        <label className="lottie-field-row">
          <span className="lottie-field-label">Background</span>
          <div className="lottie-color-row">
            <span className="lottie-color-swatch">
              <input
                type="color"
                value={settings.backgroundColor ?? '#000000'}
                onChange={(event) => updateSettings({ backgroundColor: event.target.value })}
                aria-label="Background color"
              />
            </span>
            <input
              className="lottie-input"
              type="text"
              value={settings.backgroundColor ?? ''}
              onChange={(event) => updateSettings({ backgroundColor: cleanBackgroundColor(event.target.value) })}
              placeholder="transparent"
            />
          </div>
        </label>
      </div>
    </div>
  );
}
