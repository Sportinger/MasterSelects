import { useEffect, useId, useState, type ReactNode } from 'react';
import './InspectorPrimitives.css';

export type InspectorVariant = 'export' | 'resolve';

export interface InspectorSectionProps {
  alwaysOpenWhenEnabled?: boolean;
  children: ReactNode;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  enabled?: boolean;
  headerActions?: ReactNode;
  indicator?: 'active' | 'inactive' | 'none';
  onEnabledChange?: (enabled: boolean) => void;
  readOnlyIndicator?: 'button' | 'status';
  target?: string;
  title: string;
  variant: InspectorVariant;
}

export function InspectorSection({
  alwaysOpenWhenEnabled = false,
  children,
  className,
  collapsible = true,
  defaultOpen = true,
  enabled,
  headerActions,
  indicator = 'none',
  onEnabledChange,
  readOnlyIndicator = 'button',
  target,
  title,
  variant,
}: InspectorSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const indicatorEnabled = enabled ?? indicator === 'active';
  const hasIndicator = indicator !== 'none';
  const prefix = `${variant}-inspector`;
  const statusClass = variant === 'resolve' ? `${prefix}-status-dot` : `${prefix}-status-switch`;

  useEffect(() => {
    if (alwaysOpenWhenEnabled && enabled !== undefined) setOpen(enabled);
  }, [alwaysOpenWhenEnabled, enabled]);

  const toggleEnabled = () => {
    const nextEnabled = !indicatorEnabled;
    if (alwaysOpenWhenEnabled) setOpen(nextEnabled);
    onEnabledChange?.(nextEnabled);
  };

  return (
    <section
      className={[
        'inspector-section',
        `${prefix}-section`,
        open ? 'is-open' : '',
        hasIndicator && !indicatorEnabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-export-target={target}
    >
      <div className={`inspector-section-header ${prefix}-section-header`}>
        <button
          aria-controls={contentId}
          aria-expanded={open}
          className={`inspector-disclosure ${prefix}-disclosure`}
          disabled={!collapsible}
          onClick={() => {
            if (collapsible) setOpen(current => !current);
          }}
          type="button"
        >
          <svg aria-hidden="true" viewBox="0 0 12 12">
            <path d="m3 4 3 3 3-3" />
          </svg>
          {hasIndicator && <span aria-hidden="true" className={`inspector-status-spacer ${prefix}-status-spacer`} />}
          <span>{title}</span>
        </button>
        {hasIndicator && (onEnabledChange || readOnlyIndicator === 'button' ? (
          <button
            aria-checked={indicatorEnabled}
            aria-label={`${indicatorEnabled ? 'Disable' : 'Enable'} ${title}`}
            className={`inspector-status-control ${statusClass} is-${indicatorEnabled ? 'active' : 'inactive'}`}
            disabled={!onEnabledChange}
            onClick={toggleEnabled}
            role="switch"
            type="button"
          />
        ) : (
          <span
            aria-hidden="true"
            className={`inspector-status-control ${statusClass} is-${indicatorEnabled ? 'active' : 'inactive'}`}
          />
        ))}
        {headerActions && (
          <div className={`inspector-header-actions ${prefix}-header-actions`}>{headerActions}</div>
        )}
      </div>
      {open && (
        <div className={`inspector-section-content ${prefix}-section-content`} id={contentId}>
          {children}
        </div>
      )}
    </section>
  );
}

export interface InspectorRowProps {
  actions?: ReactNode;
  alwaysRenderActions?: boolean;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  target?: string;
  title?: string;
  variant: InspectorVariant;
}

export function InspectorRow({
  actions,
  alwaysRenderActions = false,
  children,
  className,
  disabled = false,
  label,
  target,
  title,
  variant,
}: InspectorRowProps) {
  const prefix = `${variant}-inspector`;
  return (
    <div
      aria-disabled={disabled || undefined}
      className={[
        'inspector-row',
        `${prefix}-row`,
        disabled ? 'is-disabled' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-export-target={target}
      title={title}
    >
      <span className={`inspector-row-label ${prefix}-row-label`}>{label}</span>
      <div className={`inspector-row-control ${prefix}-row-control`}>{children}</div>
      {(actions || alwaysRenderActions) && (
        <div className={`inspector-row-actions ${prefix}-row-actions`}>{actions}</div>
      )}
    </div>
  );
}
