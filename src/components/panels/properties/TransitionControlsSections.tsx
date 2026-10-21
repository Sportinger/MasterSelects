import {
  getBooleanTransitionParam,
  getTransitionParamValue,
  type TransitionDefinition,
  type TransitionParamDefinition,
  type TransitionParamValue,
} from '../../../transitions';
import type { TimelineTransition } from '../../../types/timelineCore';
import type { AudioCrossfadeResolution } from '../../../services/audio/audioCrossfadePlanning';

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
  /** The sound this transition blends, or why Include audio blends nothing. */
  audio: AudioCrossfadeResolution | null;
  onUpdateDuration: (duration: number) => void;
  onUpdateParam: (paramId: string, value: TransitionParamValue) => void;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
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
  'linked-audio-on-different-tracks': 'The clips\u2019 sound is on different tracks – nothing to blend',
} as const;

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
  audio,
  onUpdateDuration,
  onUpdateParam,
}: TransitionControlsSectionsProps) {
  const params = getVisibleParams(definition, transition, isAudioOnlyTransition, handledParamIds);
  const fade = audio?.pair?.fade;
  const audioShortened = !!fade && fade.overlap < duration - 0.005;
  return (
    <>
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
            onChange={(event) => onUpdateDuration(Number(event.currentTarget.value))}
          />
          <span className="transition-static-value">{formatSeconds(bodyStart)} - {formatSeconds(bodyEnd)}</span>
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
        {fade ? (
          <div className="control-row" title="The sound fades only where both clips have sound beyond the cut">
            <span className="prop-label">Audio</span>
            <span className={audioShortened ? 'transition-hold-value' : 'transition-static-value'}>
              {fade.kind === 'declick' ? 'Cut (no extra sound)' : formatSeconds(fade.overlap)}
            </span>
          </div>
        ) : null}
      </section>

      <section className="properties-section">
        <h4>Parameters</h4>
        {params.length === 0 ? (
          <div className="transition-static-value">No additional parameters</div>
        ) : params.map(([paramId, param]) => {
          const value = getTransitionParamValue(transition, definition, paramId);
          if (param.type === 'boolean') {
            const skipReason = paramId === 'includeAudio' && value === true ? audio?.skipReason : undefined;
            return (
              <div key={paramId}>
                <label className="control-row transition-param-row transition-checkbox-row">
                  <span className="prop-label">{param.label}</span>
                  <input
                    type="checkbox"
                    checked={value === true}
                    onChange={(event) => onUpdateParam(paramId, event.currentTarget.checked)}
                  />
                </label>
                {skipReason ? <div className="transition-param-note">{AUDIO_SKIP_NOTES[skipReason]}</div> : null}
              </div>
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
                  onChange={(event) => onUpdateParam(paramId, Number(event.currentTarget.value))}
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
                  onChange={(event) => onUpdateParam(paramId, event.currentTarget.value)}
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
                onChange={(event) => onUpdateParam(paramId, event.currentTarget.value)}
              />
            </div>
          );
        })}
      </section>
    </>
  );
}
