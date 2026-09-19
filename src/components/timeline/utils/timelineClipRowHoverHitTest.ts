import type { MouseEvent as ReactMouseEvent } from 'react';

export function hitTestTimelineClipRowHover(
  event: ReactMouseEvent<HTMLDivElement>,
  hitTestClipAtClientX: (clientX: number, rowEl: HTMLElement) => string | null,
): string | null {
  // Edge controls extend past the clip's time interval. Keep their owning clip
  // hovered so entering the outer half does not unmount the handle before down.
  const edgeControl = (event.target as Element).closest(
    '[data-shell-trim-edge], [data-shell-fade-edge]',
  );
  const shell = edgeControl?.closest<HTMLElement>('.clip-interaction-shell[data-clip-id]');
  return shell && event.currentTarget.contains(shell)
    ? shell.dataset.clipId ?? null
    : hitTestClipAtClientX(event.clientX, event.currentTarget);
}
