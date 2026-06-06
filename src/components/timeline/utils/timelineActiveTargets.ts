const TIMELINE_ACTIVE_TARGET_SELECTORS = [
  '.timeline-clip-preview',
  '.clip-interaction-shell',
  '[data-shell-trim-edge]',
  '[data-shell-fade-edge]',
  '[data-clip-interaction-slot]',
  '.clip-keyframe-ticks',
  '.keyframe-tick',
].join(',');

export function isTimelineActiveTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(TIMELINE_ACTIVE_TARGET_SELECTORS));
}
