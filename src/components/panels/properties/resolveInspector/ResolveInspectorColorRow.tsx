import { useRef } from 'react';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './ResolveInspectorPrimitives';
import './ResolveInspectorColorRow.css';

interface ResolveInspectorColorRowProps {
  label: string;
  ariaLabel?: string;
  /** '#rrggbb' (other input shows the default). */
  value: string;
  defaultValue: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

const hex = (value: string, fallback: string) => /^#[\da-f]{6}$/i.test(value) ? value.toLowerCase() : fallback.toLowerCase();

/** Colour well with its hex value and a reset action, in the shared Resolve inspector row. */
export function ResolveInspectorColorRow({ label, ariaLabel = label, value, defaultValue, disabled = false, onChange }: ResolveInspectorColorRowProps) {
  // A colour chosen with the pointer leaves no focus ring on the well; keyboard focus stays visible.
  const pointerChange = useRef(false);
  const color = hex(value, defaultValue);
  return <ResolveInspectorRow label={label} disabled={disabled} actions={<ResolveInspectorIconButton ariaLabel={`Reset ${label}`}
    className="resolve-inspector-reset-button" disabled={disabled}
    onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onChange(hex(defaultValue, '#000000')); }}><ResolveResetIcon /></ResolveInspectorIconButton>}>
    <div className="resolve-inspector-color-value">
      <input type="color" className="resolve-inspector-color-swatch" aria-label={ariaLabel} value={color} disabled={disabled}
        onPointerDown={() => { pointerChange.current = true; }} onKeyDown={() => { pointerChange.current = false; }}
        onChange={event => {
          onChange(event.target.value.toLowerCase());
          if (pointerChange.current) event.currentTarget.blur();
          pointerChange.current = false;
        }} />
      <span className="resolve-inspector-color-hex">{color.toUpperCase()}</span>
    </div>
  </ResolveInspectorRow>;
}
