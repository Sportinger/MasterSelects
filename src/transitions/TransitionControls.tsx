// Generic Transition Controls
// Renders parameter UI from a transition's param schema (mirrors EffectControls).

import { TRANSITION_REGISTRY } from './index';
import type { TransitionParam } from './types';

interface TransitionControlsProps {
  transitionType: string;
  params: Record<string, number | boolean | string>;
  onChange: (key: string, value: number | boolean | string) => void;
}

export function TransitionControls({ transitionType, params, onChange }: TransitionControlsProps) {
  const def = TRANSITION_REGISTRY.get(transitionType as Parameters<typeof TRANSITION_REGISTRY.get>[0]);
  if (!def) return null;

  const entries = Object.entries(def.params);
  if (entries.length === 0) return null;

  return (
    <div className="transition-controls">
      {entries.map(([key, paramDef]) => (
        <TransitionParamControl
          key={key}
          paramKey={key}
          paramDef={paramDef}
          value={params[key] ?? paramDef.default}
          onChange={(value) => onChange(key, value)}
        />
      ))}
    </div>
  );
}

interface TransitionParamControlProps {
  paramKey: string;
  paramDef: TransitionParam;
  value: number | boolean | string;
  onChange: (value: number | boolean | string) => void;
}

function TransitionParamControl({ paramDef, value, onChange }: TransitionParamControlProps) {
  const handleReset = (e: React.MouseEvent) => {
    e.preventDefault();
    onChange(paramDef.default);
  };

  switch (paramDef.type) {
    case 'number':
      return (
        <div className="transition-control-row" onContextMenu={handleReset}>
          <label>{paramDef.label}</label>
          <input
            type="range"
            min={paramDef.min ?? 0}
            max={paramDef.max ?? 1}
            step={paramDef.step ?? 0.01}
            value={value as number}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <span className="transition-value-display">
            {typeof value === 'number' ? value.toFixed(2) : value}
          </span>
        </div>
      );

    case 'boolean':
      return (
        <div className="transition-control-row">
          <label>
            <input
              type="checkbox"
              checked={value as boolean}
              onChange={(e) => onChange(e.target.checked)}
            />
            {paramDef.label}
          </label>
        </div>
      );

    case 'select':
      return (
        <div className="transition-control-row">
          <label>{paramDef.label}</label>
          <select value={value as string} onChange={(e) => onChange(e.target.value)}>
            {paramDef.options?.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      );

    case 'color':
      return (
        <div className="transition-control-row">
          <label>{paramDef.label}</label>
          <input
            type="color"
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );

    default:
      return null;
  }
}

export default TransitionControls;
