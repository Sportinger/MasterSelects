// Colour row in the shared Resolve inspector design: swatch picker, editable hex field and reset.
import { useState } from 'react';
import { ResolveInspectorIconButton, ResolveInspectorRow, ResolveResetIcon } from './ResolveInspectorPrimitives';
import './ResolveInspector.css';
import './ResolveInspectorColorRow.css';

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** `#rrggbb` for a typed hex value (3 or 6 digits, with or without #), or undefined when it is not one. */
function normalizeHexColor(text: string): string | undefined {
  const match = HEX.exec(text.trim());
  if (!match) return undefined;
  const digits = match[1].length === 3 ? [...match[1]].map(digit => digit + digit).join('') : match[1];
  return `#${digits.toLowerCase()}`;
}

interface ResolveInspectorColorRowProps {
  label: string;
  value: string;
  defaultValue: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  /** A finished edit (picker closed, hex field committed or reset) for history and telemetry. */
  onCommit?: (method: 'select' | 'type' | 'reset') => void;
}

export function ResolveInspectorColorRow({ label, value, defaultValue, disabled = false, onChange, onCommit }: ResolveInspectorColorRowProps) {
  const colour = normalizeHexColor(value) ?? normalizeHexColor(defaultValue) ?? '#000000';
  // The hex field shows the value, or what is being typed until it is committed (Enter, blur) or dropped (Escape).
  const [draft, setDraft] = useState<string | null>(null);
  const commitDraft = () => {
    const next = draft === null ? undefined : normalizeHexColor(draft);
    if (next && next !== colour) { onChange(next); onCommit?.('type'); }
    setDraft(null);
  };
  return (
    <ResolveInspectorRow label={label} disabled={disabled}
      actions={<ResolveInspectorIconButton ariaLabel={`Reset ${label}`} className="resolve-inspector-reset-button" disabled={disabled}
        onClick={() => { onChange(normalizeHexColor(defaultValue) ?? colour); onCommit?.('reset'); }}><ResolveResetIcon /></ResolveInspectorIconButton>}>
      <span className="resolve-inspector-color">
        {/* Pointer activation shows no focus ring (ResolveInspectorColorRow.css); keyboard focus keeps the product ring. */}
        <input type="color" aria-label={label} value={colour} disabled={disabled}
          onChange={event => onChange(event.target.value)} onBlur={() => onCommit?.('select')} />
        <input type="text" aria-label={`${label} hex`} value={draft ?? colour} disabled={disabled} spellCheck={false}
          onChange={event => setDraft(event.target.value)} onBlur={commitDraft}
          onKeyDown={event => {
            if (event.key === 'Enter') { event.preventDefault(); commitDraft(); }
            if (event.key === 'Escape') { event.preventDefault(); setDraft(null); }
          }} />
      </span>
    </ResolveInspectorRow>
  );
}
