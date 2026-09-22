import type { ComponentProps, ReactNode } from 'react';
import { getEffectiveEditableDraggableNumberSettings, useEditableDraggableNumberSettingsRevision } from '../../../common/EditableDraggableNumberSettings';
import { LabeledValue } from '../LabeledValue';
import { HandleOnlyRange } from '../transformTab/HandleOnlyRange';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './ResolveInspectorPrimitives';
import './ResolveInspector.css';
import './ResolveInspectorNarrow.css';

interface ResolveInspectorNumberRowProps {
  label: string;
  suffix?: string;
  decimals?: number;
  sensitivity?: number;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onCommit?: ComponentProps<typeof LabeledValue>['onCommit'];
  keyframeToggle?: ReactNode;
  actions?: ReactNode;
  ariaLabel?: string;
  value: number;
  defaultValue: number;
  min: number;
  max: number;
  step: number;
  hardMin?: number;
  hardMax?: number;
  disabled?: boolean;
  persistenceKey?: string;
  onChange: (value: number) => void;
  onReset?: (value: number) => void;
}

/** Transform-style slider, editable field and reset action for effect inspectors. */
export function ResolveInspectorNumberRow({
  label, ariaLabel = label, value, defaultValue, min, max, step, disabled = false,
  persistenceKey, onChange, onReset, keyframeToggle, actions, suffix, decimals, sensitivity = 2,
  onDragStart, onDragEnd, onCommit, hardMin = -Infinity, hardMax = Infinity,
}: ResolveInspectorNumberRowProps) {
  useEditableDraggableNumberSettingsRevision(persistenceKey);
  const range = getEffectiveEditableDraggableNumberSettings({ persistenceKey, min, max, defaultValue });
  const effectiveMin = Math.max(hardMin, Math.min(hardMax, range.min ?? min));
  const effectiveMax = Math.max(effectiveMin, Math.min(hardMax, range.max ?? max));
  const change = (next: number) => {
    if (Number.isFinite(next)) onChange(Math.max(hardMin, Math.min(hardMax, next)));
  };
  return <ResolveInspectorRow label={label} disabled={disabled} className={actions ? 'resolve-inspector-row--extra-action' : undefined} actions={<>
    {actions}
    {keyframeToggle}
    <ResolveInspectorIconButton ariaLabel={`Reset ${label}`} className="resolve-inspector-reset-button"
      disabled={disabled} onClick={() => { (onReset ?? change)(range.defaultValue ?? defaultValue); onCommit?.('reset'); }}><ResolveResetIcon /></ResolveInspectorIconButton>
  </>}>
    <div className="resolve-inspector-slider-value">
      <HandleOnlyRange aria-label={`${ariaLabel} slider`} value={value} min={effectiveMin} max={effectiveMax}
        step={step} disabled={disabled} onChange={change} onDragStart={onDragStart}
        onDragEnd={() => { onDragEnd?.(); onCommit?.('drag'); }} />
      <LabeledValue label="" ariaLabel={ariaLabel} className="resolve-inspector-field resolve-inspector-field--plain"
        value={value} defaultValue={defaultValue} min={min} max={max} decimals={decimals ?? (step >= 1 ? 0 : 3)} suffix={suffix}
        sensitivity={sensitivity} onDragStart={onDragStart} onDragEnd={onDragEnd} onCommit={onCommit} touchDragAxis="horizontal" disabled={disabled} persistenceKey={persistenceKey}
        onChange={change} />
    </div>
  </ResolveInspectorRow>;
}
