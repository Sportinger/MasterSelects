// Generic Effect Controls Component
// Renders UI controls based on effect parameter definitions

import React from 'react';
import { EFFECT_REGISTRY } from './index';
import type { EffectParam } from './types';

interface EffectControlsComponentProps {
  effectType: string;
  params: Record<string, number | boolean | string>;
  onChange: (params: Record<string, number | boolean | string>) => void;
  clipId?: string;
  renderKeyframeToggle?: (property: string) => React.ReactNode;
}

/**
 * Renders controls for an effect based on its parameter definitions
 */
export function EffectControls({
  effectType,
  params,
  onChange,
  clipId,
  renderKeyframeToggle,
}: EffectControlsComponentProps) {
  const effect = EFFECT_REGISTRY.get(effectType);
  if (!effect) return null;

  // Check if effect has custom controls
  if (effect.customControls) {
    const CustomControls = effect.customControls;
    return (
      <CustomControls
        effectId={effectType}
        params={params}
        onChange={onChange}
        clipId={clipId}
      />
    );
  }

  // Render generic controls based on parameter definitions
  return (
    <div className="effect-controls">
      {Object.entries(effect.params).map(([key, paramDef]) => (
        <EffectParamControl
          key={key}
          paramKey={key}
          paramDef={paramDef}
          value={params[key] ?? paramDef.default}
          onChange={(value) => onChange({ ...params, [key]: value })}
          clipId={clipId}
          renderKeyframeToggle={renderKeyframeToggle}
        />
      ))}
    </div>
  );
}

interface EffectParamControlProps {
  paramKey: string;
  paramDef: EffectParam;
  value: number | boolean | string;
  onChange: (value: number | boolean | string) => void;
  clipId?: string;
  renderKeyframeToggle?: (property: string) => React.ReactNode;
}

/**
 * Renders a single parameter control based on its type
 */
function EffectParamControl({
  paramKey,
  paramDef,
  value,
  onChange,
  clipId,
  renderKeyframeToggle,
}: EffectParamControlProps) {
  const handleReset = (e: React.MouseEvent) => {
    e.preventDefault();
    onChange(paramDef.default);
  };

  switch (paramDef.type) {
    case 'number':
      return (
        <div className="control-row" onContextMenu={handleReset}>
          <label>{paramDef.label}</label>
          <input
            type="range"
            min={paramDef.min ?? 0}
            max={paramDef.max ?? 1}
            step={paramDef.step ?? 0.01}
            value={value as number}
            onChange={(e) => onChange(parseFloat(e.target.value))}
          />
          <span className="value-display">
            {typeof value === 'number' ? value.toFixed(2) : value}
          </span>
          {paramDef.animatable && clipId && renderKeyframeToggle?.(paramKey)}
        </div>
      );

    case 'boolean':
      return (
        <div className="control-row checkbox-row">
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
        <div className="control-row">
          <label>{paramDef.label}</label>
          <select
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          >
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
        <div className="control-row">
          <label>{paramDef.label}</label>
          <input
            type="color"
            value={value as string}
            onChange={(e) => onChange(e.target.value)}
          />
          {paramDef.animatable && clipId && renderKeyframeToggle?.(paramKey)}
        </div>
      );

    case 'point':
      // Point would need X/Y controls - implement as needed
      return (
        <div className="control-row">
          <label>{paramDef.label}</label>
          <span>Point control (TODO)</span>
        </div>
      );

    default:
      return null;
  }
}

export default EffectControls;
