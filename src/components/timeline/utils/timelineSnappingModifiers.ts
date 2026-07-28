export interface TimelineSnappingModifiers {
  altKey?: boolean;
  shiftKey?: boolean;
}

/**
 * Alt always bypasses snapping. Otherwise the persisted toggle enables it
 * normally and Shift enables it only for the current pointer gesture.
 */
export function isTimelineSnappingActive(
  snappingEnabled: boolean,
  modifiers: TimelineSnappingModifiers,
): boolean {
  if (modifiers.altKey === true) return false;
  return snappingEnabled || modifiers.shiftKey === true;
}
