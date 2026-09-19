import {
  IconColorPicker,
  IconCurrentLocation,
  IconRotateClockwise2,
} from '@tabler/icons-react';
import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';

import { PRIMARY_COLOR_PARAM_DEFS } from '../../../types/colorCorrection';
import { trackEditorControlCommitted } from '../../../services/productAnalytics';
import { DraggableNumber, KeyframeToggle, MultiKeyframeToggle } from '../properties/shared';
import { MIDIParameterLabel } from '../properties/MIDIParameterLabel';
import {
  WHEEL_CONTROL_CONFIGS,
  clampNumber,
  getWheelParamDef,
  getWheelPuckPosition,
  type WheelControlConfig,
} from './colorEditorMath';
import type { ColorEditorParamDefinition } from './colorEditorTypes';
import type { WheelColorControlsProps } from './WheelColorControls';
import './ResolveWheelColorControls.css';

type ResolveWheelProps = Omit<WheelColorControlsProps, 'resolveLayout'>;

interface ResolveParameterConfig {
  key?: string;
  label: string;
  decimals: number;
  scale?: number;
  offset?: number;
  staticValue?: number;
  tone: string;
}

const TOP_CONTROLS: ResolveParameterConfig[] = [
  { key: 'temperature', label: 'Temp', decimals: 1, scale: 100, tone: 'temperature' },
  { key: 'tint', label: 'Tint', decimals: 2, scale: 100, tone: 'tint' },
  { key: 'contrast', label: 'Contrast', decimals: 3, tone: 'neutral' },
  { key: 'pivot', label: 'Pivot', decimals: 3, tone: 'neutral-dark' },
  { label: 'Mid/Detail', decimals: 2, staticValue: 0, tone: 'detail' },
];

const BOTTOM_CONTROLS: ResolveParameterConfig[] = [
  { key: 'vibrance', label: 'Color Boost', decimals: 2, scale: 100, tone: 'spectrum' },
  { key: 'shadows', label: 'Shadows', decimals: 2, scale: 100, tone: 'shadow' },
  { key: 'highlights', label: 'Highlights', decimals: 2, scale: 100, tone: 'highlight' },
  { key: 'saturation', label: 'Saturation', decimals: 2, scale: 50, tone: 'spectrum' },
  { key: 'hue', label: 'Hue', decimals: 2, scale: 1 / 3.6, offset: 50, tone: 'spectrum' },
  { label: 'Lum Mix', decimals: 2, staticValue: 100, tone: 'neutral' },
];

const RESOLVE_GAMMA_EFFECTIVE_MAX = 3.2;
const RESOLVE_GAMMA_RAW_MAX = Math.sqrt(RESOLVE_GAMMA_EFFECTIVE_MAX);
const RESOLVE_GAMMA_DISPLAY_SCALE = 1 / (RESOLVE_GAMMA_RAW_MAX - 1);
const RESOLVE_GAMMA_CHROMA_RANGE = 0.65;
const RESOLVE_GAMMA_CAP_ROTATION = 122;
const RESOLVE_GAMMA_INTERACTION_RANGE = (RESOLVE_GAMMA_RAW_MAX - 1) * 300 / RESOLVE_GAMMA_CAP_ROTATION;
const RESOLVE_OFFSET_SIGNAL_LIMIT = 0.25;
const RESOLVE_OFFSET_DISPLAY_NEUTRAL = 25;
const RESOLVE_OFFSET_DISPLAY_SCALE = 100;

function getPrimaryParamDef(key: string): ColorEditorParamDefinition {
  const definition = PRIMARY_COLOR_PARAM_DEFS.find(candidate => candidate.key === key);
  if (!definition) throw new Error(`Missing primary color parameter definition for ${key}`);
  return definition;
}

function trackResolveControl(controlId: string, inputMethod: 'drag' | 'keyboard' | 'reset' | 'type') {
  trackEditorControlCommitted({
    area: 'color',
    controlId,
    controlKind: 'number',
    inputMethod,
    interaction: inputMethod === 'reset' ? 'reset' : 'change',
    itemId: controlId,
    itemKind: 'property',
  });
}

interface ResolveLumaSliderProps {
  defaultValue: number;
  label: string;
  max: number;
  min: number;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onChange: (value: number) => void;
  onReset: () => void;
  step: number;
  value: number;
}

function ResolveLumaSlider({
  defaultValue,
  label,
  max,
  min,
  onBatchEnd,
  onBatchStart,
  onChange,
  onReset,
  step,
  value,
}: ResolveLumaSliderProps) {
  const dragStateRef = useRef<{
    pointerId: number;
    lastClientX: number;
    value: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const clampedValue = clampNumber(value, min, max);
  const distanceFromNeutral = clampedValue - defaultValue;
  const directionalRange = distanceFromNeutral >= 0 ? max - defaultValue : defaultValue - min;
  const signedPosition = directionalRange <= 0 ? 0 : clampNumber(distanceFromNeutral / directionalRange, -1, 1);
  const sliderStyle = {
    '--luma-glow-offset': `${isDragging ? signedPosition * 10 : 0}px`,
    '--luma-tick-offset': `${signedPosition * 37}px`,
  } as CSSProperties;

  const updateFromPointer = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - dragState.lastClientX;
    if (deltaX === 0) return;
    dragState.lastClientX = event.clientX;
    dragState.value = clampNumber(dragState.value + deltaX * step, min, max);
    onChange(dragState.value);
  };

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId !== event.pointerId) return;
    dragStateRef.current = null;
    setIsDragging(false);
    onBatchEnd();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | null = null;
    const increment = step * (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue = value - increment;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue = value + increment;
    if (event.key === 'Home') nextValue = min;
    if (event.key === 'End') nextValue = max;
    if (nextValue === null) return;
    event.preventDefault();
    onBatchStart();
    try {
      onChange(clampNumber(nextValue, min, max));
    } finally {
      onBatchEnd();
    }
  };

  return (
    <div
      aria-label={label}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className="resolve-wheel-luma-slider"
      data-dragging={isDragging ? 'true' : undefined}
      onDoubleClick={event => {
        event.preventDefault();
        event.stopPropagation();
        onReset();
      }}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={finishPointer}
      onPointerCancel={finishPointer}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        dragStateRef.current = {
          pointerId: event.pointerId,
          lastClientX: event.clientX,
          value: clampedValue,
        };
        setIsDragging(true);
        event.currentTarget.setPointerCapture(event.pointerId);
        onBatchStart();
      }}
      onPointerMove={event => {
        updateFromPointer(event);
      }}
      onPointerUp={finishPointer}
      role="slider"
      style={sliderStyle}
      tabIndex={0}
    />
  );
}

interface ResolveMasterWheelProps {
  config: WheelControlConfig;
  defaultValue: number;
  interactionRange?: number;
  max: number;
  min: number;
  onBatchEnd: () => void;
  onBatchStart: () => void;
  onColorPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onMasterChange: (value: number) => void;
  onReset: () => void;
  padStyle: CSSProperties;
  step: number;
  value: number;
}

interface MasterRingDrag {
  accumulatedAngle: number;
  lastAngle: number;
  pointerId: number;
  startValue: number;
}

function getPointerAngle(element: HTMLDivElement, event: PointerEvent<HTMLDivElement>): number {
  const rect = element.getBoundingClientRect();
  return Math.atan2(
    event.clientY - (rect.top + rect.height / 2),
    event.clientX - (rect.left + rect.width / 2),
  );
}

function ResolveMasterWheel({
  config,
  defaultValue,
  interactionRange,
  max,
  min,
  onBatchEnd,
  onBatchStart,
  onColorPointerDown,
  onMasterChange,
  onReset,
  padStyle,
  step,
  value,
}: ResolveMasterWheelProps) {
  const dragRef = useRef<MasterRingDrag | null>(null);
  const valueRange = max - min;
  const dragValueRange = interactionRange ?? valueRange;
  const baseRingRotation = config.id === 'gain' ? 0 : 180;
  const ringRotation = baseRingRotation + (dragValueRange === 0
    ? 0
    : (clampNumber(value, min, max) - defaultValue) / dragValueRange * 300);
  const wheelStyle = {
    ...padStyle,
    '--luma-ring-rotation': `${ringRotation}deg`,
  } as CSSProperties;

  const finishPointer = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    onBatchEnd();
    trackResolveControl(`${config.id}.master`, 'drag');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    let nextValue: number | null = null;
    const increment = step * (event.shiftKey ? 10 : 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') nextValue = value - increment;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') nextValue = value + increment;
    if (event.key === 'Home') nextValue = min;
    if (event.key === 'End') nextValue = max;
    if (nextValue === null) return;
    event.preventDefault();
    onBatchStart();
    try {
      onMasterChange(clampNumber(nextValue, min, max));
    } finally {
      onBatchEnd();
    }
    trackResolveControl(`${config.id}.master`, 'keyboard');
  };

  return (
    <div
      aria-label={`${config.label} master ring`}
      aria-valuemax={max}
      aria-valuemin={min}
      aria-valuenow={value}
      className={`resolve-wheel-ring-control is-${config.id}`}
      onDoubleClick={event => {
        event.preventDefault();
        if (event.target === event.currentTarget) onReset();
      }}
      onKeyDown={handleKeyDown}
      onLostPointerCapture={finishPointer}
      onPointerCancel={finishPointer}
      onPointerDown={event => {
        if (event.target !== event.currentTarget || event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.stopPropagation();
        dragRef.current = {
          accumulatedAngle: 0,
          lastAngle: getPointerAngle(event.currentTarget, event),
          pointerId: event.pointerId,
          startValue: value,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        onBatchStart();
      }}
      onPointerMove={event => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId || dragValueRange === 0) return;
        const angle = getPointerAngle(event.currentTarget, event);
        let angleDelta = angle - drag.lastAngle;
        if (angleDelta > Math.PI) angleDelta -= Math.PI * 2;
        if (angleDelta < -Math.PI) angleDelta += Math.PI * 2;
        drag.accumulatedAngle += angleDelta;
        drag.lastAngle = angle;
        const rawValue = drag.startValue + drag.accumulatedAngle / (Math.PI * 2) * dragValueRange;
        const steppedValue = min + Math.round((rawValue - min) / step) * step;
        onMasterChange(clampNumber(steppedValue, min, max));
      }}
      onPointerUp={finishPointer}
      role="slider"
      style={wheelStyle}
      tabIndex={0}
    >
      <div
        className={`color-wheel-pad color-wheel-pad-${config.id}`}
        onDoubleClick={event => {
          event.preventDefault();
          event.stopPropagation();
          onReset();
        }}
        onPointerDown={onColorPointerDown}
        role="presentation"
      >
        <span aria-hidden="true" className="resolve-wheel-grid" />
        <span className="color-wheel-puck" />
      </div>
    </div>
  );
}

function ResolveParameterControl({
  clipId,
  config,
  node,
  createProperty,
  getParamValue,
  setParam,
  onBatchStart,
  onBatchEnd,
}: Pick<ResolveWheelProps,
  'clipId' | 'node' | 'createProperty' | 'getParamValue' | 'setParam' | 'onBatchStart' | 'onBatchEnd'
> & { config: ResolveParameterConfig }) {
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

  return (
    <div className={`resolve-primary-parameter is-${config.tone}`}>
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

export function ResolveWheelColorControls({
  clipId,
  node,
  wheelParamDefs,
  createProperty,
  getParamValue,
  setParam,
  resetWheel,
  startWheelDrag,
  onBatchStart,
  onBatchEnd,
}: ResolveWheelProps) {
  const parameterProps = {
    clipId,
    node,
    createProperty,
    getParamValue,
    setParam,
    onBatchStart,
    onBatchEnd,
  };

  return (
    <div className="resolve-primaries">
      <div className="resolve-primaries-top-row">
        <div className="resolve-primaries-leading-tools" aria-hidden="true">
          <span>A</span>
          <IconColorPicker size={17} stroke={1.8} />
        </div>
        {TOP_CONTROLS.map(config => (
          <ResolveParameterControl config={config} key={config.label} {...parameterProps} />
        ))}
      </div>

      <div className="resolve-color-wheels-grid">
        {WHEEL_CONTROL_CONFIGS.map(config => {
          const rDef = getWheelParamDef(wheelParamDefs, config.rKey);
          const gDef = getWheelParamDef(wheelParamDefs, config.gKey);
          const bDef = getWheelParamDef(wheelParamDefs, config.bKey);
          const yDef = getWheelParamDef(wheelParamDefs, config.yKey);
          const isResolveGamma = config.id === 'gamma';
          const isResolveOffset = config.id === 'offset';
          const controlConfig = isResolveGamma
            ? { ...config, chromaRange: RESOLVE_GAMMA_CHROMA_RANGE }
            : config;
          const getControlBounds = (def: ColorEditorParamDefinition) => {
            if (isResolveGamma) return {
              min: def.min,
              max: Math.min(def.max, RESOLVE_GAMMA_RAW_MAX),
            };
            if (isResolveOffset) return {
              min: Math.max(def.min, -RESOLVE_OFFSET_SIGNAL_LIMIT),
              max: Math.min(def.max, RESOLVE_OFFSET_SIGNAL_LIMIT),
            };
            return { min: def.min, max: def.max };
          };
          const yBounds = getControlBounds(yDef);
          const controlStep = isResolveGamma
            ? 0.01 / RESOLVE_GAMMA_DISPLAY_SCALE
            : isResolveOffset ? 0.01 / RESOLVE_OFFSET_DISPLAY_SCALE
            : yDef.step;
          const values = {
            r: getParamValue(node, config.rKey, rDef.defaultValue),
            g: getParamValue(node, config.gKey, gDef.defaultValue),
            b: getParamValue(node, config.bKey, bDef.defaultValue),
          };
          const yValue = getParamValue(node, config.yKey, yDef.defaultValue);
          const applyMasterValue = (nextValue: number) => {
            const nextYValue = clampNumber(nextValue, yBounds.min, yBounds.max);
            const delta = nextYValue - yValue;
            if (Math.abs(delta) < Number.EPSILON) return;

            if (config.id === 'offset') {
              setParam(node.id, config.yKey, nextYValue);
              return;
            }

            const rBounds = getControlBounds(rDef);
            const gBounds = getControlBounds(gDef);
            const bBounds = getControlBounds(bDef);
            setParam(node.id, config.rKey, clampNumber(values.r + delta, rBounds.min, rBounds.max));
            setParam(node.id, config.gKey, clampNumber(values.g + delta, gBounds.min, gBounds.max));
            setParam(node.id, config.bKey, clampNumber(values.b + delta, bBounds.min, bBounds.max));
            setParam(node.id, config.yKey, nextYValue);
          };
          const puck = getWheelPuckPosition(controlConfig, values, rDef.defaultValue);
          const padStyle = {
            '--puck-x': `${50 + puck.x * 41}%`,
            '--puck-y': `${50 - puck.y * 41}%`,
          } as CSSProperties;
          const valueDisplayOffset = isResolveOffset
            ? RESOLVE_OFFSET_DISPLAY_NEUTRAL
            : isResolveGamma ? -RESOLVE_GAMMA_DISPLAY_SCALE : 0;
          const valueDisplayScale = isResolveOffset
            ? RESOLVE_OFFSET_DISPLAY_SCALE
            : isResolveGamma ? RESOLVE_GAMMA_DISPLAY_SCALE : 1;
          const channelControls = [
            ...(config.id === 'offset' ? [] : [{ channel: 'y', key: config.yKey, def: yDef, value: yValue }]),
            { channel: 'r', key: config.rKey, def: rDef, value: values.r + (config.id === 'offset' ? yValue : 0) },
            { channel: 'g', key: config.gKey, def: gDef, value: values.g + (config.id === 'offset' ? yValue : 0) },
            { channel: 'b', key: config.bKey, def: bDef, value: values.b + (config.id === 'offset' ? yValue : 0) },
          ];

          return (
            <section className="resolve-color-wheel" key={config.id}>
              <header>
                <button type="button" title={`Center ${config.label}`} onClick={() => resetWheel(node.id, config)}>
                  <IconCurrentLocation size={17} stroke={1.45} />
                </button>
                <strong>
                  <MultiKeyframeToggle
                    clipId={clipId}
                    dragId={`${clipId}:${node.id}:${config.id}`}
                    title={`Add ${config.label} keyframes`}
                    entries={[config.rKey, config.gKey, config.bKey, config.yKey].map(key => {
                      const def = getWheelParamDef(wheelParamDefs, key);
                      return { property: createProperty(node.id, key), value: getParamValue(node, key, def.defaultValue) };
                    })}
                  />
                  {config.label}
                </strong>
                <button type="button" title={`Reset ${config.label}`} onClick={() => resetWheel(node.id, config)}>
                  <IconRotateClockwise2 size={15} stroke={1.45} />
                </button>
              </header>
              <ResolveMasterWheel
                config={controlConfig}
                defaultValue={yDef.defaultValue}
                interactionRange={isResolveGamma ? RESOLVE_GAMMA_INTERACTION_RANGE : undefined}
                max={yBounds.max}
                min={yBounds.min}
                onBatchEnd={onBatchEnd}
                onBatchStart={onBatchStart}
                onColorPointerDown={event => startWheelDrag(event, node, controlConfig, 0.45)}
                onMasterChange={applyMasterValue}
                onReset={() => resetWheel(node.id, config)}
                padStyle={padStyle}
                step={controlStep}
                value={yValue}
              />

              <div className={`resolve-wheel-values${config.id === 'offset' ? ' is-offset' : ''}`}>
                {channelControls.map(({ channel, key, def, value }) => {
                  const property = createProperty(node.id, key);
                  const rawBounds = getControlBounds(def);
                  const displayValue = clampNumber(value, rawBounds.min, rawBounds.max)
                    * valueDisplayScale + valueDisplayOffset;
                  const displayMin = rawBounds.min * valueDisplayScale + valueDisplayOffset;
                  const displayMax = rawBounds.max * valueDisplayScale + valueDisplayOffset;
                  return (
                    <div className={`resolve-wheel-value is-${channel}`} key={key}>
                      <span className="resolve-wheel-keyframe-toggle">
                        <KeyframeToggle clipId={clipId} property={property} value={getParamValue(node, key, def.defaultValue)} />
                      </span>
                      <DraggableNumber
                        ariaLabel={`${config.label} ${channel.toUpperCase()}`}
                        value={displayValue}
                        onChange={nextValue => {
                          const rawValue = clampNumber(
                            (nextValue - valueDisplayOffset) / valueDisplayScale,
                            rawBounds.min,
                            rawBounds.max,
                          );
                          if (channel === 'y') {
                            applyMasterValue(rawValue);
                          } else {
                            setParam(
                              node.id,
                              key,
                              clampNumber(rawValue - (config.id === 'offset' ? yValue : 0), rawBounds.min, rawBounds.max),
                            );
                          }
                        }}
                        defaultValue={def.defaultValue * valueDisplayScale + valueDisplayOffset}
                        sensitivity={Math.max(0.01, (displayMax - displayMin) / 80)}
                        decimals={2}
                        min={displayMin}
                        max={displayMax}
                        persistenceKey={`color.resolve.${clipId}.${node.id}.${key}`}
                        onDragStart={onBatchStart}
                        onDragEnd={onBatchEnd}
                        onCommit={method => trackResolveControl(key, method)}
                      />
                    </div>
                  );
                })}
              </div>

              <ResolveLumaSlider
                defaultValue={yDef.defaultValue}
                label={`${config.label} luminance`}
                min={yBounds.min}
                max={yBounds.max}
                step={controlStep}
                value={clampNumber(yValue, yBounds.min, yBounds.max)}
                onChange={applyMasterValue}
                onBatchStart={onBatchStart}
                onBatchEnd={onBatchEnd}
                onReset={() => resetWheel(node.id, config)}
              />
            </section>
          );
        })}
      </div>

      <div className="resolve-primaries-bottom-row">
        {BOTTOM_CONTROLS.map(config => (
          <ResolveParameterControl config={config} key={config.label} {...parameterProps} />
        ))}
      </div>
    </div>
  );
}
