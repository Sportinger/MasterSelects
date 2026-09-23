import type { MouseEventHandler, ReactNode } from 'react';
import { InspectorRow, InspectorSection } from '../../../inspector/InspectorPrimitives';
import { useEffectSectionBypass } from './EffectSectionBypass';

interface ResolveInspectorSectionProps {
  children: ReactNode;
  bypassGroupId?: string;
  className?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  enabled?: boolean;
  headerActions?: ReactNode;
  indicator?: 'active' | 'inactive' | 'none';
  onEnabledChange?: (enabled: boolean) => void;
  title: string;
}

export function ResolveInspectorSection({
  children,
  bypassGroupId,
  className,
  collapsible = true,
  defaultOpen = true,
  enabled,
  headerActions,
  indicator = 'active',
  onEnabledChange,
  title,
}: ResolveInspectorSectionProps) {
  const groupBypass = useEffectSectionBypass(bypassGroupId ? `group:${bypassGroupId}` : title);
  return (
    <InspectorSection
      alwaysOpenWhenEnabled
      className={className}
      collapsible={collapsible}
      defaultOpen={defaultOpen}
      enabled={enabled ?? groupBypass?.enabled}
      headerActions={headerActions}
      indicator={indicator}
      onEnabledChange={onEnabledChange ?? (enabled === undefined && indicator !== 'none' ? groupBypass?.onEnabledChange : undefined)}
      readOnlyIndicator="status"
      title={title}
      variant="resolve"
    >
      {children}
    </InspectorSection>
  );
}

interface ResolveInspectorRowProps {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  label: string;
  title?: string;
}

export function ResolveInspectorRow({
  actions,
  children,
  className,
  disabled = false,
  label,
  title,
}: ResolveInspectorRowProps) {
  return (
    <InspectorRow
      actions={actions}
      alwaysRenderActions
      className={className}
      disabled={disabled}
      label={label}
      title={title}
      variant="resolve"
    >
      {children}
    </InspectorRow>
  );
}

interface ResolveInspectorIconButtonProps {
  active?: boolean;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  title?: string;
}

export function ResolveInspectorIconButton({
  active,
  ariaLabel,
  children,
  className,
  disabled = false,
  onClick,
  title,
}: ResolveInspectorIconButtonProps) {
  return (
    <button
      aria-label={ariaLabel}
      aria-pressed={active === undefined ? undefined : active}
      className={[
        'resolve-inspector-icon-button',
        active ? 'is-active' : '',
        className,
      ].filter(Boolean).join(' ')}
      disabled={disabled}
      onClick={onClick}
      title={title ?? ariaLabel}
      type="button"
    >
      {children}
    </button>
  );
}

export function ResolveResetIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="M4.1 5.1A5.1 5.1 0 1 1 3 9.7" />
      <path d="M1.8 3.2v3.5h3.5" />
    </svg>
  );
}

export function ResolveLinkIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16">
      <path d="m6.1 10.7-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7l2.1-2.1A2.6 2.6 0 0 1 7 6" />
      <path d="m9.9 5.3 1.2-1.2a2.6 2.6 0 0 1 3.7 3.7l-2.1 2.1A2.6 2.6 0 0 1 9 10" />
      <path d="m5.4 10.6 5.2-5.2" />
    </svg>
  );
}
