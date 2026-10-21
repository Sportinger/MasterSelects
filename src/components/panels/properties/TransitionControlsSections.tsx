import {
  getBooleanTransitionParam,
  getTransitionParamValue,
  type TransitionDefinition,
  type TransitionParamDefinition,
  type TransitionParamValue,
} from '../../../transitions';
import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import type { TimelineClip } from '../../../types/timeline';
import type { TimelineTransition } from '../../../types/timelineCore';
import { resolveAudioCrossfadeFromClip, type AudioCrossfadeResolution } from '../../../services/audio/audioCrossfadePlanning';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { TransitionSourceDurationResolver } from '../../../stores/timeline/editOperations/transitionPlanner';
import { ResolveInspectorRow, ResolveInspectorSection } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';

interface TransitionControlsSectionsProps {
  definition: TransitionDefinition;
  transition: TimelineTransition;
  duration: number;
  bodyStart: number;
  bodyEnd: number;
  realHandleDuration: number;
  holdDuration: number;
  /** Two sound clips: Include audio is implied and not shown. */
  isAudioOnlyTransition: boolean;
  /** Parameters an earlier section already shows (e.g. the dip colour). */
  handledParamIds: ReadonlySet<string>;
  /** The clip before the cut; its Crossfade's sound is shown in the Audio row. */
  outgoingClip: TimelineClip | null;
  getMediaDuration: TransitionSourceDurationResolver;
  onUpdateDuration: (duration: number) => void;
  onUpdateParam: (paramId: string, value: TransitionParamValue) => void;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)} s`;
}

function getVisibleParams(
  definition: TransitionDefinition,
  transition: TimelineTransition,
  isAudioOnlyTransition: boolean,
  handledParamIds: ReadonlySet<string>,
): Array<[string, TransitionParamDefinition]> {
  const blendsSound = isAudioOnlyTransition || getBooleanTransitionParam(transition, definition, 'includeAudio');
  return Object.entries(definition.params ?? {})
    .filter(([, param]) => param.hidden !== true)
    .filter(([paramId]) => !(isAudioOnlyTransition && paramId === 'includeAudio'))
    .filter(([, param]) => param.audioOnly !== true || blendsSound)
    .filter(([paramId]) => !handledParamIds.has(paramId));
}

const AUDIO_SKIP_NOTES = {
  'no-linked-audio': 'No linked sound on one track – nothing to blend',
  'linked-audio-on-different-tracks': 'The clips’ sound is on different tracks – nothing to blend',
} as const;

const CURVE_LABELS = { 'equal-power': 'Equal power', 'equal-gain': 'Equal gain' } as const;

/** Mouse, pen and touch clicks leave no focus ring on a checkbox; the keyboard keeps its own. */
function blurAfterPointer(event: ReactPointerEvent<HTMLInputElement>): void {
  const target = event.currentTarget;
  requestAnimationFrame(() => target.blur());
}

function getSelectOptions(paramId: string, param: TransitionParamDefinition, audio: AudioCrossfadeResolution | null) {
  return (param.options ?? []).map((option) => ({
    // Auto shows what it plays for these clips.
    label: paramId === 'audioCurve' && option.value === 'auto' && audio?.pair
      ? `Auto (${CURVE_LABELS[audio.pair.fade.curve]})`
      : option.label,
    value: String(option.value),
  }));
}

/** Transition timing, source handles and parameters in the unified inspector rows. */
export function TransitionControlsSections({
  definition,
  transition,
  duration,
  bodyStart,
  bodyEnd,
  realHandleDuration,
  holdDuration,
  isAudioOnlyTransition,
  handledParamIds,
  outgoingClip,
  getMediaDuration,
  onUpdateDuration,
  onUpdateParam,
}: TransitionControlsSectionsProps) {
  const clips = useTimelineStore(state => state.clips);
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes);
  const frameRate = useMediaStore(state =>
    state.compositions.find(composition => composition.id === state.activeCompositionId)?.frameRate ?? 30);
  const fps = Number.isFinite(frameRate) && frameRate > 0 ? frameRate : 30;
  // The same plan preview and export use: the sound this Crossfade blends, or why it blends none.
  const audio = useMemo(() => outgoingClip?.transitionOut?.type === 'crossfade'
    ? resolveAudioCrossfadeFromClip(outgoingClip, clips, { getMediaDuration, getClipKeyframes: id => clipKeyframes.get(id) })
    : null, [clipKeyframes, clips, getMediaDuration, outgoingClip]);
  const params = getVisibleParams(definition, transition, isAudioOnlyTransition, handledParamIds);
  const fade = audio?.pair?.fade;
  const audioShortened = !!fade && fade.overlap < duration - 0.005;
  // Whole project frames, so the transition starts and ends on a frame.
  const minFrames = Math.max(1, Math.ceil(definition.minDuration * fps - 1e-6));
  const maxFrames = Math.max(minFrames, Math.floor((definition.maxDuration ?? 10) * fps + 1e-6));
  const toFrames = (seconds: number) => Math.min(maxFrames, Math.max(minFrames, Math.round(seconds * fps)));
  const frames = toFrames(duration);
  return (
    <>
      <ResolveInspectorSection indicator="none" title="Timing">
        <ResolveInspectorNumberRow
          label="Duration"
          value={duration}
          defaultValue={definition.defaultDuration}
          min={minFrames / fps}
          max={maxFrames / fps}
          hardMin={minFrames / fps}
          hardMax={maxFrames / fps}
          step={1 / fps}
          decimals={2}
          suffix=" s"
          onChange={(seconds) => onUpdateDuration(toFrames(seconds) / fps)}
        />
        <ResolveInspectorRow label="Range">
          <span className="transition-static-value">
            {formatSeconds(bodyStart)} – {formatSeconds(bodyEnd)} · {frames} frames
          </span>
        </ResolveInspectorRow>
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Source Handles">
        <ResolveInspectorRow label="Real">
          <span className="transition-static-value">{formatSeconds(realHandleDuration)}</span>
        </ResolveInspectorRow>
        <ResolveInspectorRow label="Hold">
          <span className={holdDuration > 0 ? 'transition-hold-value' : 'transition-static-value'}>
            {formatSeconds(holdDuration)}
          </span>
        </ResolveInspectorRow>
        {fade ? (
          <ResolveInspectorRow label="Audio" title="The sound fades only where both clips have sound beyond the cut">
            <span className={audioShortened ? 'transition-hold-value' : 'transition-static-value'}>
              {!audio?.pair?.usesHandles ? 'Cut (retimed clip)'
                : fade.kind === 'declick' ? 'Cut (no extra sound)' : formatSeconds(fade.overlap)}
            </span>
          </ResolveInspectorRow>
        ) : null}
      </ResolveInspectorSection>

      <ResolveInspectorSection indicator="none" title="Parameters">
        {params.length === 0 ? (
          <div className="transition-static-value">No additional parameters</div>
        ) : params.map(([paramId, param]) => {
          const value = getTransitionParamValue(transition, definition, paramId);
          if (param.type === 'boolean') {
            const skipReason = paramId === 'includeAudio' && value === true ? audio?.skipReason : undefined;
            return (
              <div key={paramId}>
                <ResolveInspectorRow label={param.label}>
                  <input
                    type="checkbox"
                    className="transition-param-checkbox"
                    aria-label={param.label}
                    checked={value === true}
                    onPointerUp={blurAfterPointer}
                    onChange={(event) => onUpdateParam(paramId, event.currentTarget.checked)}
                  />
                </ResolveInspectorRow>
                {skipReason ? <div className="transition-param-note">{AUDIO_SKIP_NOTES[skipReason]}</div> : null}
              </div>
            );
          }
          if (param.type === 'number') {
            const fallback = Number(param.defaultValue);
            return (
              <ResolveInspectorNumberRow
                key={paramId}
                label={param.label}
                value={typeof value === 'number' ? value : fallback}
                defaultValue={fallback}
                min={param.min ?? 0}
                max={param.max ?? Math.max(1, fallback)}
                step={param.step ?? 0.01}
                onChange={(next) => onUpdateParam(paramId, next)}
              />
            );
          }
          if (param.type === 'select') {
            return (
              <ResolveInspectorRow key={paramId} label={param.label}>
                <InspectorSelect
                  ariaLabel={param.label}
                  value={String(value ?? param.defaultValue)}
                  options={getSelectOptions(paramId, param, audio)}
                  onChange={(next) => onUpdateParam(paramId, next)}
                  onReset={() => onUpdateParam(paramId, param.defaultValue)}
                />
              </ResolveInspectorRow>
            );
          }
          return (
            <ResolveInspectorRow key={paramId} label={param.label}>
              <input
                className={param.type === 'color' ? 'transition-param-color' : 'resolve-inspector-field'}
                aria-label={param.label}
                type={param.type === 'color' ? 'color' : 'text'}
                value={String(value ?? param.defaultValue)}
                onChange={(event) => onUpdateParam(paramId, event.currentTarget.value)}
              />
            </ResolveInspectorRow>
          );
        })}
      </ResolveInspectorSection>
    </>
  );
}
