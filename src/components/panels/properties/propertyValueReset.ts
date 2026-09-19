import type { MouseEvent as ReactMouseEvent } from 'react';

export const PROPERTY_VALUE_RESET_TITLE = 'Right-click to reset to default';

export function resetPropertyValueOnContextMenu(
  event: ReactMouseEvent<HTMLElement>,
  reset: () => void,
): void {
  event.preventDefault();
  event.stopPropagation();
  reset();
}
