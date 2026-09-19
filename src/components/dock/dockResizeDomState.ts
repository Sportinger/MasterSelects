export const DOCK_RESIZE_AXIS_ATTRIBUTE = 'data-dock-resize-axis';

export function isDockResizeActive(): boolean {
  return typeof document !== 'undefined'
    && document.documentElement.hasAttribute(DOCK_RESIZE_AXIS_ATTRIBUTE);
}
