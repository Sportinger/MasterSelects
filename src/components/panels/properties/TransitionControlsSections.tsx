import {
  getTransitionParamValue,
  type TransitionDefinition,
  type TransitionParamDefinition,
  type TransitionParamValue,
} from '../../../transitions';
import type { TimelineTransition } from '../../../types/timelineCore';

interface TransitionControlsSectionsProps {
  definition: TransitionDefinition;
  transition: TimelineTransition;
  duration: number;
  bodyStart: number;
  bodyEnd: number;
  realHandleDuration: number;
  holdDuration: number;
  params: Array<[string, TransitionParamDefinition]>;
  onUpdateDuration: (duration: number) => void;
  onUpdateParam: (paramId: string, value: TransitionParamValue) => void;
}

function formatSeconds(value: number): string {
  return `${value.toFixed(2)}s`;
}

export function TransitionControlsSections({
  definition,
  transition,
  duration,
  bodyStart,
  bodyEnd,
  realHandleDuration,
  holdDuration,
  params,
  onUpdateDuration,
  onUpdateParam,
}: TransitionControlsSectionsProps) {
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
                  onChange={(event) => onUpdateParam(paramId, event.currentTarget.checked)}
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
