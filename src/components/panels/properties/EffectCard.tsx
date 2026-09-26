import { EffectColorStripe } from './EffectColorStripe';
import { useEffect, useId, useState, type ComponentProps, type ReactNode } from 'react';
import './EffectCard.css';

type EffectCardProps = Omit<ComponentProps<'div'>, 'title'> & {
  title: string;
  colorIdentity?: string;
  children: ReactNode;
  enabled?: boolean;
  onEnabledChange?: (enabled: boolean) => void;
  onRemove?: () => void;
  headerActions?: ReactNode;
  onMoveEarlier?: () => void;
  onMoveLater?: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  dragHandleProps?: ComponentProps<'span'>;
};

/** Audio cards reuse the existing video effect card styling. */
export function EffectCard({ title, colorIdentity, children, enabled = true, onEnabledChange, onRemove,
  headerActions, onMoveEarlier, onMoveLater, collapsed, onToggleCollapsed, dragHandleProps, className = '', ...props }: EffectCardProps) {
  const [localCollapsed, setLocalCollapsed] = useState(!enabled);
  const contentId = useId();
  const [reorderOpen, setReorderOpen] = useState(false);
  const isCollapsed = collapsed ?? localCollapsed;
  useEffect(() => { if (!enabled) setLocalCollapsed(true); }, [enabled]);
  return <div {...props} className={`effect-item audio-effect-card ${!enabled ? 'bypassed' : ''} ${className}`}>
    <div className="effect-header">
      {colorIdentity && <EffectColorStripe identity={colorIdentity} />}
      {dragHandleProps && <span className="effect-drag-handle" title="Drag to reorder; click for ordering actions" role="button" tabIndex={0} aria-label={`Reorder ${title}`}
        onClick={() => setReorderOpen(value => !value)} onKeyDown={event => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            (event.key === 'ArrowUp' ? onMoveEarlier : onMoveLater)?.();
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault(); setReorderOpen(value => !value);
          }
        }} {...dragHandleProps}>&#9776;</span>}
      <button type="button" className="effect-collapse-toggle" aria-expanded={!isCollapsed}
        aria-controls={contentId} title={`${isCollapsed ? 'Expand' : 'Collapse'} ${title}`}
        onClick={() => onToggleCollapsed ? onToggleCollapsed() : setLocalCollapsed(value => !value)}>
        <span className="effect-collapse-chevron" aria-hidden="true">{isCollapsed ? '\u25B6' : '\u25BC'}</span>
        <span className="effect-name">{title}</span>
      </button>
      {onEnabledChange && <button type="button" role="switch" aria-checked={enabled}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${title}`}
        className={`effect-bypass-btn ${!enabled ? 'bypassed' : ''}`}
        onClick={() => onEnabledChange(!enabled)} title={enabled ? 'Bypass effect' : 'Enable effect'}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2">
          {enabled ? <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /> : <circle cx="12" cy="12" r="10" strokeDasharray="4 4" />}
          {enabled && <polyline points="22 4 12 14.01 9 11.01" />}
        </svg>
      </button>}
      {headerActions}
      {onRemove && <button type="button" className="btn btn-sm btn-danger" aria-label={`Remove ${title}`}
        onClick={onRemove}>&#215;</button>}
    </div>
    {reorderOpen && dragHandleProps && <div className="effect-reorder-actions" role="group" aria-label={`Reorder ${title}`}>
      <button type="button" className="btn btn-sm" disabled={!onMoveEarlier}
        onClick={() => { onMoveEarlier?.(); setReorderOpen(false); }}>Move {title} earlier</button>
      <button type="button" className="btn btn-sm" disabled={!onMoveLater}
        onClick={() => { onMoveLater?.(); setReorderOpen(false); }}>Move {title} later</button>
    </div>}
    {!isCollapsed && <div className="effect-params resolve-inspector-section" id={contentId} inert={!enabled || undefined}>{children}</div>}
  </div>;
}
