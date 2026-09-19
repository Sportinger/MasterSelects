import type { ReactNode } from 'react';
import { InspectorRow, InspectorSection } from '../../inspector/InspectorPrimitives';

interface ExportInspectorSectionProps {
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  enabled?: boolean;
  headerActions?: ReactNode;
  indicator?: 'active' | 'inactive' | 'none';
  onEnabledChange?: (enabled: boolean) => void;
  target?: string;
  title: string;
}

export function ExportInspectorSection({
  children,
  className,
  defaultOpen = true,
  enabled,
  headerActions,
  indicator = 'none',
  onEnabledChange,
  target,
  title,
}: ExportInspectorSectionProps) {
  return (
    <InspectorSection
      alwaysOpenWhenEnabled
      className={className}
      defaultOpen={defaultOpen}
      enabled={enabled}
      headerActions={headerActions}
      indicator={indicator}
      onEnabledChange={onEnabledChange}
      target={target}
      title={title}
      variant="export"
    >
      {children}
    </InspectorSection>
  );
}

interface ExportInspectorRowProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  target?: string;
  title?: string;
}

export function ExportInspectorRow({
  actions,
  children,
  className,
  disabled = false,
  label,
  target,
  title,
}: ExportInspectorRowProps) {
  return (
    <InspectorRow
      actions={actions}
      className={className}
      disabled={disabled}
      label={label}
      target={target}
      title={title}
      variant="export"
    >
      {children}
    </InspectorRow>
  );
}

interface ExportInspectorToggleProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function ExportInspectorToggle({
  checked,
  disabled = false,
  label,
  onChange,
}: ExportInspectorToggleProps) {
  return (
    <label className="export-inspector-toggle">
      <input
        checked={checked}
        disabled={disabled}
        onChange={event => onChange(event.target.checked)}
        type="checkbox"
      />
      <span>{label}</span>
    </label>
  );
}

interface ExportInspectorMatchCheckboxProps {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}

export function ExportInspectorMatchCheckbox({
  checked,
  label,
  onChange,
}: ExportInspectorMatchCheckboxProps) {
  return (
    <label className="export-inspector-match-checkbox" title={label}>
      <input
        aria-label={label}
        checked={checked}
        onChange={event => onChange(event.target.checked)}
        type="checkbox"
      />
      <span aria-hidden="true" className="export-composition-checkmark" />
    </label>
  );
}

export function ExportInspectorNote({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'success';
}) {
  return <p className={`export-inspector-note is-${tone}`}>{children}</p>;
}
