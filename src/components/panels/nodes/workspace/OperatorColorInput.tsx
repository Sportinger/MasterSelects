import { useRef } from 'react';

interface OperatorColorInputProps {
  ariaLabel: string;
  value: string;
  onChange: (value: string) => void;
}

/** Native color well backed by the graph's exact hex value, including optional alpha. */
export function OperatorColorInput({ ariaLabel, value, onChange }: OperatorColorInputProps) {
  const pointerChange = useRef(false);
  const candidate = value.startsWith('#') ? value : `#${value}`;
  const normalized = /^#[\da-f]{6}([\da-f]{2})?$/i.test(candidate) ? candidate : '#000000';
  const alpha = normalized.length === 9 ? normalized.slice(7) : '';
  return <input type="color" aria-label={ariaLabel} value={normalized.slice(0, 7)}
    onPointerDown={() => { pointerChange.current = true; }}
    onKeyDown={() => { pointerChange.current = false; }}
    onChange={event => {
      onChange(`${event.target.value}${alpha}`);
      if (pointerChange.current) event.currentTarget.blur();
      pointerChange.current = false;
    }} />;
}
