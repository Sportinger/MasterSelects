// Generic Effect Controls Component
// Renders UI controls based on effect parameter definitions

import React, { Suspense, lazy, type ComponentType, type LazyExoticComponent } from 'react';
import { EFFECT_REGISTRY } from './index';
import type { EffectControlProps, EffectParam } from './types';
import { groupEffectParameters } from './parameterGroups';
import { LabeledValue } from '../components/panels/properties/LabeledValue';
import '../components/panels/properties/effectValueControls.css';
import './effectParameterGroups.css';

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

  const groups = groupEffectParameters(effect.params);
  const ExtraControls = 'extraControls' in effect && effect.extraControls
    ? getExtraControls(effectType, effect.extraControls)
    : undefined;

  const renderParams = (entries: Array<[string, EffectParam]>) => entries.map(([key, paramDef]) => (
    <EffectParamControl
      key={key}
      paramKey={key}
      paramDef={paramDef}
      value={params[key] ?? paramDef.default}
      onChange={(value) => onChange({ ...params, [key]: value })}
      clipId={clipId}
      renderKeyframeToggle={renderKeyframeToggle}
    />
  ));

  return (
    <div className="effect-controls effects-tab transform-tab-compact">
      {groups.map((group) => group.quality ? (
        <details className="effect-param-section" key={group.id}>
          <summary className="effect-param-section-title">Quality</summary>
          {renderParams(group.params)}
        </details>
      ) : group.label ? (
        <fieldset className="effect-param-section" key={group.id}>
          <legend className="effect-param-section-title">{group.label}</legend>
          {renderParams(group.params)}
        </fieldset>
      ) : (
        <div className="effect-param-section" key={group.id}>{renderParams(group.params)}</div>
      ))}
      {ExtraControls && (
        <div className="effect-param-section">
          <Suspense fallback={null}>
            <ExtraControls effectId={effectType} params={params} onChange={onChange} clipId={clipId} />
          </Suspense>
        </div>
      )}
    </div>
  );
}

type ExtraControlsLoader = () => Promise<{ default: ComponentType<EffectControlProps> }>;
const extraControlsCache = new Map<string, LazyExoticComponent<ComponentType<EffectControlProps>>>();

export function getExtraControls(effectType: string, loader: ExtraControlsLoader) {
  let component = extraControlsCache.get(effectType);
  if (!component) {
    component = lazy(loader);
    extraControlsCache.set(effectType, component);
  }
  return component;
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
        <div className="control-row effect-param-row">
          <LabeledValue
            className="effect-param-value"
            label={paramDef.label}
            min={paramDef.min ?? 0}
            max={paramDef.max ?? 1}
            value={value as number}
            onChange={onChange}
            defaultValue={paramDef.default as number}
            decimals={paramDef.step && paramDef.step >= 1 ? 0 : paramDef.step && paramDef.step >= 0.1 ? 1 : 2}
            sensitivity={Math.max(0.5, ((paramDef.max ?? 1) - (paramDef.min ?? 0)) / 100)}
            ariaLabel={paramDef.label}
            keyframeToggle={paramDef.animatable && clipId
              ? renderKeyframeToggle?.(paramKey)
              : undefined}
          />
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

    case 'text':
      return (
        <div className="control-row" onContextMenu={handleReset}>
          <label>{paramDef.label}</label>
          <input type="text" value={value as string} onChange={(e) => onChange(e.target.value)} />
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
