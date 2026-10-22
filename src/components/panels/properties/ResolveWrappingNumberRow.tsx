// The inspector row of a cyclic value (EffectParam.wraps, e.g. Hue Shift): the same slider, field and
// reset as ResolveInspectorNumberRow, but the slider handle sits at the value's place on one turn
// (a stored 240° shows at -120° on a -180..180° slider) and a slider move keeps the whole turns
// (240° + one step = 241°), while the field shows and types the stored value without any limit.
// It lives here until ResolveInspectorNumberRow can take a separate slider value and an unlimited
// field (ledger, C2 round 2).
import type { ComponentProps, ReactNode } from 'react';
import { getEffectiveEditableDraggableNumberSettings, useEditableDraggableNumberSettingsRevision } from '../../common/EditableDraggableNumberSettings';
import { LabeledValue } from './LabeledValue';
import { HandleOnlyRange } from './transformTab/HandleOnlyRange';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './resolveInspector/ResolveInspectorPrimitives';
import { useInspectorHistoryBatch } from './resolveInspector/useInspectorHistoryBatch';
import './resolveInspector/ResolveInspector.css';
import './resolveInspector/ResolveInspectorNarrow.css';

interface ResolveWrappingNumberRowProps {
  label: string;
  ariaLabel?: string;
  value: number;
  defaultValue: number;
  /** One turn of the slider, in display units (Hue Shift: -180..180). */
  min: number;
  max: number;
  step: number;
  suffix?: string;
  decimals?: number;
  sensitivity?: number;
  disabled?: boolean;
  title?: string;
  persistenceKey?: string;
  midiTarget?: ComponentProps<typeof LabeledValue>['midiTarget'];
  keyframeToggle?: ReactNode;
  onChange: (value: number) => void;
  onReset?: (value: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onCommit?: ComponentProps<typeof LabeledValue>['onCommit'];
}

/** The slider position of a cyclic value: itself on the slider, else wrapped by whole turns into [min, max). */
function wrappedSliderValue(value: number, min: number, max: number): number {
  const period = max - min;
  if (!(period > 0) || (value >= min && value <= max)) return value;
  return min + (((value - min) % period) + period) % period;
}

export function ResolveWrappingNumberRow({
  label, ariaLabel = label, value, defaultValue, min, max, step, suffix, decimals, sensitivity = 2, disabled = false,
  title, persistenceKey, midiTarget, keyframeToggle, onChange, onReset, onDragStart, onDragEnd, onCommit,
}: ResolveWrappingNumberRowProps) {
  const drag = useInspectorHistoryBatch(label, onDragStart, onDragEnd);
  useEditableDraggableNumberSettingsRevision(persistenceKey);
  const range = getEffectiveEditableDraggableNumberSettings({ persistenceKey, min, max, defaultValue });
  const sliderMin = range.min ?? min, sliderMax = Math.max(sliderMin, range.max ?? max);
  const change = (next: number) => { if (Number.isFinite(next)) onChange(next); };
  // The turn is the declared one (min..max), also when the slider range was narrowed in its settings.
  const sliderValue = wrappedSliderValue(value, min, max);
  return <ResolveInspectorRow label={label} disabled={disabled} title={title} actions={<>
    {keyframeToggle}
    <ResolveInspectorIconButton ariaLabel={`Reset ${label}`} className="resolve-inspector-reset-button"
      disabled={disabled} onClick={() => { (onReset ?? change)(range.defaultValue ?? defaultValue); onCommit?.('reset'); }}><ResolveResetIcon /></ResolveInspectorIconButton>
  </>}>
    <div className="resolve-inspector-slider-value">
      <HandleOnlyRange aria-label={`${ariaLabel} slider`} value={sliderValue} min={sliderMin} max={sliderMax}
        step={step} disabled={disabled} onChange={next => change(value + (next - sliderValue))} onDragStart={drag.begin}
        onDragEnd={() => { drag.end(); onCommit?.('drag'); }} />
      <LabeledValue label="" ariaLabel={ariaLabel} className="resolve-inspector-field resolve-inspector-field--plain"
        value={value} defaultValue={defaultValue} decimals={decimals ?? (step >= 1 ? 0 : 3)} suffix={suffix}
        sensitivity={sensitivity} onDragStart={drag.begin} onDragEnd={drag.end} onCommit={onCommit} touchDragAxis="horizontal" disabled={disabled} persistenceKey={persistenceKey}
        midiTarget={midiTarget} onChange={change} />
    </div>
  </ResolveInspectorRow>;
}
