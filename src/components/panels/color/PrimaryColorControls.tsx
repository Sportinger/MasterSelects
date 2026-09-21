import type { ComponentProps } from 'react';

import { DraggableNumber, KeyframeToggle } from '../properties/shared';
import {
  getEffectiveEditableDraggableNumberSettings,
} from '../../common/EditableDraggableNumberSettings';
import { MIDIParameterLabel } from '../properties/MIDIParameterLabel';
import { clampNumber } from './colorEditorMath';
import type { ColorEditorNode, ColorEditorParamDefinition } from './colorEditorTypes';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';

function trackColorControl(controlId: string, controlKind: 'number' | 'slider', inputMethod: 'drag' | 'keyboard' | 'reset' | 'type') {
  trackEditorControlCommitted({
    area: 'color',
    controlId,
    controlKind,
    inputMethod,
    interaction: inputMethod === 'reset' ? 'reset' : 'change',
    itemId: controlId,
    itemKind: 'property',
  });
}

type KeyframeProperty = ComponentProps<typeof KeyframeToggle>['property'];

interface PrimaryColorControlsProps {
  isParamDriven?: (key: string) => boolean;
  clipId: string;
  node: ColorEditorNode;
  paramSections: [string, ColorEditorParamDefinition[]][];
  createProperty: (nodeId: string, key: string) => KeyframeProperty;
  getParamValue: (node: ColorEditorNode, key: string, defaultValue: number) => number;
  setParam: (nodeId: string, paramName: string, value: number) => void;
  onBatchStart: () => void;
  onBatchEnd: () => void;
}

export function PrimaryColorControls({
  isParamDriven = () => false,
  clipId,
  node,
  paramSections,
  createProperty,
  getParamValue,
  setParam,
  onBatchStart,
  onBatchEnd,
}: PrimaryColorControlsProps) {
  return (
    <div className="properties-section color-control-section">
      {paramSections.map(([section, defs]) => (
        <div className="color-control-group" key={section}>
          <h4>{section}</h4>
          {defs.map(def => {
            const property = createProperty(node.id, def.key);
            const value = getParamValue(node, def.key, def.defaultValue);
            const midiTarget = {
              clipId,
              property,
              label: `Color ${def.label}`,
              currentValue: value,
              min: def.min,
              max: def.max,
            };
            const persistenceKey = `color.${clipId}.${node.id}.${def.key}`;
            const sliderSettings = getEffectiveEditableDraggableNumberSettings({
              persistenceKey,
              min: def.min,
              max: def.max,
              defaultValue: def.defaultValue,
            });
            const sliderMin = sliderSettings.min ?? def.min;
            const sliderMax = sliderSettings.max ?? def.max;

            return (
              <div className="control-row color-control-row" key={def.key} inert={isParamDriven(def.key)} aria-disabled={isParamDriven(def.key)}>
                <KeyframeToggle clipId={clipId} property={property} value={value} />
                <MIDIParameterLabel as="label" target={midiTarget}>{def.label}</MIDIParameterLabel>
                <input
                  type="range"
                  min={sliderMin}
                  max={sliderMax}
                  step={def.step}
                  value={clampNumber(value, sliderMin, sliderMax)}
                  onChange={(rangeEvent) => setParam(node.id, def.key, Number(rangeEvent.target.value))}
                  onPointerDown={onBatchStart}
                  onPointerUp={() => {
                    onBatchEnd();
                    trackColorControl(def.key, 'slider', 'drag');
                  }}
                  onKeyDown={onBatchStart}
                  onKeyUp={() => {
                    onBatchEnd();
                    trackColorControl(def.key, 'slider', 'keyboard');
                  }}
                />
                <DraggableNumber
                  value={value}
                  onChange={(nextValue) => setParam(node.id, def.key, nextValue)}
                  defaultValue={def.defaultValue}
                  sensitivity={Math.max(0.5, (def.max - def.min) / 80)}
                  decimals={def.decimals}
                  min={def.min}
                  max={def.max}
                  persistenceKey={persistenceKey}
                  onDragStart={onBatchStart}
                  onDragEnd={onBatchEnd}
                  onCommit={(method) => trackColorControl(def.key, 'number', method)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
