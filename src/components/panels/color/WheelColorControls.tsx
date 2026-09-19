import type { ComponentProps, CSSProperties, PointerEvent } from 'react';

import { DraggableNumber, KeyframeToggle } from '../properties/shared';
import {
  getEffectiveEditableDraggableNumberSettings,
} from '../../common/EditableDraggableNumberSettings';
import { MIDIParameterLabel } from '../properties/MIDIParameterLabel';
import {
  WHEEL_CONTROL_CONFIGS,
  clampNumber,
  getWheelParamDef,
  getWheelPuckPosition,
  type WheelControlConfig,
} from './colorEditorMath';
import type { ColorEditorNode, ColorEditorParamDefinition } from './colorEditorTypes';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
import { ResolveWheelColorControls } from './ResolveWheelColorControls';

function trackWheelControl(controlId: string, controlKind: 'number' | 'slider', inputMethod: 'drag' | 'keyboard' | 'reset' | 'type') {
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

export interface WheelColorControlsProps {
  clipId: string;
  node: ColorEditorNode;
  wheelParamDefs: ColorEditorParamDefinition[];
  resolveLayout?: boolean;
  createProperty: (nodeId: string, key: string) => KeyframeProperty;
  getParamValue: (node: ColorEditorNode, key: string, defaultValue: number) => number;
  setParam: (nodeId: string, paramName: string, value: number) => void;
  resetWheel: (nodeId: string, config: WheelControlConfig) => void;
  startWheelDrag: (
    event: PointerEvent<HTMLDivElement>,
    node: ColorEditorNode,
    config: WheelControlConfig,
    sensitivity?: number,
  ) => void;
  onBatchStart: () => void;
  onBatchEnd: () => void;
}

export function WheelColorControls({
  clipId,
  node,
  wheelParamDefs,
  resolveLayout = false,
  createProperty,
  getParamValue,
  setParam,
  resetWheel,
  startWheelDrag,
  onBatchStart,
  onBatchEnd,
}: WheelColorControlsProps) {
  if (resolveLayout) {
    return (
      <ResolveWheelColorControls
        clipId={clipId}
        node={node}
        wheelParamDefs={wheelParamDefs}
        createProperty={createProperty}
        getParamValue={getParamValue}
        setParam={setParam}
        resetWheel={resetWheel}
        startWheelDrag={startWheelDrag}
        onBatchStart={onBatchStart}
        onBatchEnd={onBatchEnd}
      />
    );
  }

  return (
    <div className="properties-section color-control-section color-wheel-section">
      <div className="color-wheels-grid">
        {WHEEL_CONTROL_CONFIGS.map(config => {
          const rDef = getWheelParamDef(wheelParamDefs, config.rKey);
          const gDef = getWheelParamDef(wheelParamDefs, config.gKey);
          const bDef = getWheelParamDef(wheelParamDefs, config.bKey);
          const yDef = getWheelParamDef(wheelParamDefs, config.yKey);
          const values = {
            r: getParamValue(node, config.rKey, rDef.defaultValue),
            g: getParamValue(node, config.gKey, gDef.defaultValue),
            b: getParamValue(node, config.bKey, bDef.defaultValue),
          };
          const yProperty = createProperty(node.id, config.yKey);
          const yValue = getParamValue(node, config.yKey, yDef.defaultValue);
          const yPersistenceKey = `color.${clipId}.${node.id}.${config.yKey}`;
          const ySliderSettings = getEffectiveEditableDraggableNumberSettings({
            persistenceKey: yPersistenceKey,
            min: yDef.min,
            max: yDef.max,
            defaultValue: yDef.defaultValue,
          });
          const ySliderMin = ySliderSettings.min ?? yDef.min;
          const ySliderMax = ySliderSettings.max ?? yDef.max;
          const puck = getWheelPuckPosition(config, values, rDef.defaultValue);
          const padStyle = {
            '--puck-x': `${50 + puck.x * 43}%`,
            '--puck-y': `${50 - puck.y * 43}%`,
          } as CSSProperties;
          const channelControls = [
            { label: 'R', key: config.rKey, def: rDef, value: values.r },
            { label: 'G', key: config.gKey, def: gDef, value: values.g },
            { label: 'B', key: config.bKey, def: bDef, value: values.b },
          ];

          return (
            <div className="color-wheel-control" key={config.id}>
              <div className="color-wheel-title">
                <span>{config.label}</span>
                <button
                  type="button"
                  className="color-wheel-reset"
                  onClick={() => resetWheel(node.id, config)}
                >
                  Reset
                </button>
              </div>
              <div
                className={`color-wheel-pad color-wheel-pad-${config.id}`}
                style={padStyle}
                onPointerDown={(event) => startWheelDrag(event, node, config)}
                role="presentation"
              >
                <span className="color-wheel-puck" />
              </div>

              <div className="color-wheel-luma-row">
                <KeyframeToggle clipId={clipId} property={yProperty} value={yValue} />
                <MIDIParameterLabel
                  as="label"
                  target={{
                    clipId,
                    property: yProperty,
                    label: `Color ${config.label} Y`,
                    currentValue: yValue,
                    min: yDef.min,
                    max: yDef.max,
                  }}
                >
                  Y
                </MIDIParameterLabel>
                <input
                  type="range"
                  min={ySliderMin}
                  max={ySliderMax}
                  step={yDef.step}
                  value={clampNumber(yValue, ySliderMin, ySliderMax)}
                  onChange={(rangeEvent) => setParam(node.id, config.yKey, Number(rangeEvent.target.value))}
                  onPointerDown={onBatchStart}
                  onPointerUp={() => {
                    onBatchEnd();
                    trackWheelControl(config.yKey, 'slider', 'drag');
                  }}
                  onKeyDown={onBatchStart}
                  onKeyUp={() => {
                    onBatchEnd();
                    trackWheelControl(config.yKey, 'slider', 'keyboard');
                  }}
                />
                <DraggableNumber
                  value={yValue}
                  onChange={(nextValue) => setParam(node.id, config.yKey, nextValue)}
                  defaultValue={yDef.defaultValue}
                  sensitivity={Math.max(0.5, (yDef.max - yDef.min) / 80)}
                  decimals={yDef.decimals}
                  min={yDef.min}
                  max={yDef.max}
                  persistenceKey={yPersistenceKey}
                  onDragStart={onBatchStart}
                  onDragEnd={onBatchEnd}
                  onCommit={(method) => trackWheelControl(config.yKey, 'number', method)}
                />
              </div>

              <div className="color-wheel-channel-grid">
                {channelControls.map(({ label, key, def, value }) => {
                  const property = createProperty(node.id, key);
                  return (
                    <div className="color-wheel-channel-row" key={key}>
                      <KeyframeToggle clipId={clipId} property={property} value={value} />
                      <MIDIParameterLabel
                        as="label"
                        target={{
                          clipId,
                          property,
                          label: `Color ${config.label} ${label}`,
                          currentValue: value,
                          min: def.min,
                          max: def.max,
                        }}
                      >
                        {label}
                      </MIDIParameterLabel>
                      <DraggableNumber
                        value={value}
                        onChange={(nextValue) => setParam(node.id, key, nextValue)}
                        defaultValue={def.defaultValue}
                        sensitivity={Math.max(0.5, (def.max - def.min) / 80)}
                        decimals={def.decimals}
                        min={def.min}
                        max={def.max}
                        persistenceKey={`color.${clipId}.${node.id}.${key}`}
                        onDragStart={onBatchStart}
                        onDragEnd={onBatchEnd}
                        onCommit={(method) => trackWheelControl(key, 'number', method)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
