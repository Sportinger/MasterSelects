// Colour row in the shared Resolve inspector design: swatch picker, editable hex field and reset.
// One row for effect colour parameters (ResolveEffectParamRow) and custom controls (Chroma Key).
import { useRef, useState } from 'react';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './ResolveInspectorPrimitives';
import './ResolveInspector.css';
import './ResolveInspectorColorRow.css';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rrggbb` or `#rrggbbaa` for a hex value (3, 6 or 8 digits, with or without #), or undefined when it is not one. */
export function normalizeHexColor(text: string): string | undefined {
  const match = HEX.exec(text.trim());
  if (!match) return undefined;
  const digits = match[1].length === 3 ? [...match[1]].map(digit => digit + digit).join('') : match[1];
  return `#${digits.toLowerCase()}`;
}

interface ResolveInspectorColorRowProps {
  label: string;
  /** Accessible name of the swatch (default: the label); the hex field adds " hex". */
  ariaLabel?: string;
  /** '#rrggbb' or '#rrggbbaa' (anything else shows the default). */
  value: string;
  defaultValue: string;
  disabled?: boolean;
  /** Row tooltip, e.g. why a disabled row has no effect. */
  title?: string;
  onChange: (value: string) => void;
  /** A finished edit (picker closed, hex field committed or reset) for history and telemetry. */
  onCommit?: (method: 'select' | 'type' | 'reset') => void;
}

export function ResolveInspectorColorRow({ label, ariaLabel = label, value, defaultValue, disabled = false, title, onChange, onCommit }: ResolveInspectorColorRowProps) {
  const colour = normalizeHexColor(value) ?? normalizeHexColor(defaultValue) ?? '#000000';
  // The swatch edits the colour; an alpha stored with it (#rrggbbaa) is kept.
  const alpha = colour.length === 9 ? colour.slice(7) : '';
  // The hex field shows the value, or what is being typed until it is committed (Enter, blur) or dropped (Escape).
  const [draft, setDraft] = useState<string | null>(null);
  // A colour chosen with the pointer leaves no focus ring on the swatch; keyboard focus stays visible.
  const pointerChange = useRef(false);
  const commitDraft = () => {
    const next = draft === null ? undefined : normalizeHexColor(draft);
    if (next && next !== colour) { onChange(next); onCommit?.('type'); }
    setDraft(null);
  };
  return (
    <ResolveInspectorRow label={label} disabled={disabled} title={title}
      actions={<ResolveInspectorIconButton ariaLabel={`Reset ${label}`} className="resolve-inspector-reset-button" disabled={disabled}
        onClick={event => { if (event.detail > 0) event.currentTarget.blur(); onChange(normalizeHexColor(defaultValue) ?? colour); onCommit?.('reset'); }}>
        <ResolveResetIcon /></ResolveInspectorIconButton>}>
      <span className="resolve-inspector-color">
        {/* Pointer activation shows no focus ring (ResolveInspectorColorRow.css); keyboard focus keeps the product ring. */}
        <input type="color" aria-label={ariaLabel} value={colour.slice(0, 7)} disabled={disabled}
          onPointerDown={() => { pointerChange.current = true; }} onKeyDown={() => { pointerChange.current = false; }}
          onChange={event => {
            onChange(`${event.target.value.toLowerCase()}${alpha}`);
            if (pointerChange.current) event.currentTarget.blur();
            pointerChange.current = false;
          }} onBlur={() => onCommit?.('select')} />
        <input type="text" aria-label={`${ariaLabel} hex`} value={draft ?? colour} disabled={disabled} spellCheck={false}
          onChange={event => setDraft(event.target.value)} onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
            if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
          }} />
      </span>
    </ResolveInspectorRow>
  );
}
