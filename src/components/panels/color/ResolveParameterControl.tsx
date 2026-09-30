import type { ComponentProps } from 'react';

import { PRIMARY_COLOR_PARAM_DEFS } from '../../../types/colorCorrection';
import { DraggableNumber, KeyframeToggle } from '../properties/shared';
import { MIDIParameterLabel } from '../properties/MIDIParameterLabel';
import { clampNumber } from './colorEditorMath';
import type { ColorEditorNode, ColorEditorParamDefinition } from './colorEditorTypes';
import { trackResolveControl } from './trackResolveControl';
import './ResolveWheelColorControls.css';

type KeyframeProperty = ComponentProps<typeof KeyframeToggle>['property'];

export interface ResolveParameterConfig {
  key?: string;
  label: string;
  decimals: number;
  scale?: number;
  offset?: number;
  staticValue?: number;
  tone: string;
}

export interface ResolveParameterBindings {
  isParamDriven?: (key: string) => boolean;
  clipId: string;
  node: ColorEditorNode;
  createProperty: (nodeId: string, key: string) => KeyframeProperty;
  getParamValue: (node: ColorEditorNode, key: string, defaultValue: number) => number;
  setParam: (nodeId: string, paramName: string, value: number) => void;
  onBatchStart: () => void;
  onBatchEnd: () => void;
}

interface ResolveParameterControlProps extends ResolveParameterBindings {
  config: ResolveParameterConfig;
  keyframes?: boolean;
}

function getPrimaryParamDef(key: string): ColorEditorParamDefinition {
  const definition = PRIMARY_COLOR_PARAM_DEFS.find(candidate => candidate.key === key);
  if (!definition) throw new Error(`Missing primary color parameter definition for ${key}`);
  return definition;
}

export function ResolveParameterControl({
  isParamDriven = () => false,
  clipId,
  config,
  keyframes = false,
  node,
  createProperty,
  getParamValue,
  setParam,
  onBatchStart,
  onBatchEnd,
}: ResolveParameterControlProps) {
  if (!config.key) {
    return (
      <div className={`resolve-primary-parameter is-${config.tone} is-static`} title="Control adapter pending">
        <span>{config.label}</span>
        <output>{config.staticValue?.toFixed(config.decimals)}</output>
        <i aria-hidden="true" />
      </div>
    );
  }

  const definition = getPrimaryParamDef(config.key);
  const rawValue = getParamValue(node, definition.key, definition.defaultValue);
  const scale = config.scale ?? 1;
  const offset = config.offset ?? 0;
  const displayValue = rawValue * scale + offset;
  const displayDefault = definition.defaultValue * scale + offset;
  const displayMin = definition.min * scale + offset;
  const displayMax = definition.max * scale + offset;
  const property = createProperty(node.id, definition.key);
  const className = [
    'resolve-primary-parameter',
    `is-${config.tone}`,
    keyframes ? 'has-keyframe' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={className} inert={isParamDriven(definition.key)} aria-disabled={isParamDriven(definition.key)}>
      {keyframes && (
        <span className="resolve-primary-parameter-keyframe">
          <KeyframeToggle clipId={clipId} property={property} value={rawValue} />
        </span>
      )}
      <MIDIParameterLabel
        as="span"
        target={{
          clipId,
          property,
          label: `Color ${config.label}`,
          currentValue: rawValue,
          min: definition.min,
          max: definition.max,
        }}
      >
        {config.label}
      </MIDIParameterLabel>
      <DraggableNumber
        ariaLabel={config.label}
        value={displayValue}
        onChange={nextValue => setParam(
          node.id,
          definition.key,
          clampNumber((nextValue - offset) / scale, definition.min, definition.max),
        )}
        defaultValue={displayDefault}
        sensitivity={Math.max(0.05, (displayMax - displayMin) / 100)}
        decimals={config.decimals}
        min={Math.min(displayMin, displayMax)}
        max={Math.max(displayMin, displayMax)}
        persistenceKey={`color.resolve.${clipId}.${node.id}.${definition.key}`}
        onDragStart={onBatchStart}
        onDragEnd={onBatchEnd}
        onCommit={method => trackResolveControl(definition.key, method)}
      />
      <i aria-hidden="true" />
    </div>
  );
}
