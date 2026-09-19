import type { CSSProperties, MouseEvent } from 'react';
import {
  PROPERTY_VALUE_RESET_TITLE,
  resetPropertyValueOnContextMenu,
} from './propertyValueReset';
import './CaptionTab.css';

type PillValue = string | number;

export interface PropertyPillOption<T extends PillValue> {
  disabled?: boolean;
  label: string;
  style?: CSSProperties;
  title?: string;
  value: T;
}

interface PropertyPillSelectProps<T extends PillValue> {
  ariaLabel: string;
  className?: string;
  onChange: (value: T) => void;
  onReset?: () => void;
  options: readonly PropertyPillOption<T>[];
  value: T;
}

export function PropertyPillSelect<T extends PillValue>({
  ariaLabel,
  className,
  onChange,
  onReset,
  options,
  value,
}: PropertyPillSelectProps<T>) {
  const reset = (event: MouseEvent<HTMLButtonElement>) => {
    if (!onReset) return;
    resetPropertyValueOnContextMenu(event, onReset);
  };

  return (
    <div
      className={`property-pill-select${className ? ` ${className}` : ''}`}
      role="group"
      aria-label={ariaLabel}
    >
      {options.map(option => (
        <button
          key={String(option.value)}
          type="button"
          className={`property-pill${Object.is(option.value, value) ? ' is-active' : ''}${option.disabled ? ' is-disabled' : ''}`}
          aria-pressed={Object.is(option.value, value)}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          onContextMenu={reset}
          style={option.style}
          title={option.disabled
            ? option.title
            : onReset
            ? `${option.title ?? option.label} — ${PROPERTY_VALUE_RESET_TITLE}`
            : option.title}
        >
          <span>{option.label}</span>
        </button>
      ))}
    </div>
  );
}
