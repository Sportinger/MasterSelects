import type { MouseEvent } from 'react';

import { MaskIcon, type IconName } from './MaskIcon';

interface IconButtonProps {
  icon: IconName;
  title: string;
  active?: boolean;
  disabled?: boolean;
  guidedTarget?: string;
  className?: string;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
}

export function IconButton({
  icon,
  title,
  active,
  disabled,
  guidedTarget,
  className = '',
  onClick,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={`mask-icon-btn ${active ? 'active' : ''} ${className}`}
      title={title}
      aria-label={title}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      onClick={onClick}
      data-guided-mask-tool={guidedTarget}
      data-guided-target={guidedTarget ? `mask-toolbar:${guidedTarget}` : undefined}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
        <MaskIcon name={icon} />
      </svg>
    </button>
  );
}
