import {
  MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH,
  MEDIA_BOARD_GROUP_MAX_BODY_WIDTH,
  MEDIA_BOARD_NODE_GAP,
  MEDIA_BOARD_SLOT_CELL_WIDTH,
} from './constants';

/** Keep the normal row width, while allowing explicitly positioned items to
 * extend it. Preview and commit must use the same boundary. */
export function getMediaBoardGridColumnLimit(
  groupId: string | null,
  entries: ReadonlyArray<{ x: number; width: number }>,
): number {
  const bodyWidth = groupId === null ? MEDIA_BOARD_FOLDER_ROW_MAX_WIDTH : MEDIA_BOARD_GROUP_MAX_BODY_WIDTH;
  return Math.max(1, Math.floor(bodyWidth / MEDIA_BOARD_SLOT_CELL_WIDTH), ...entries.map(entry =>
    Math.max(0, Math.round(entry.x / MEDIA_BOARD_SLOT_CELL_WIDTH))
      + Math.max(1, Math.ceil((entry.width + MEDIA_BOARD_NODE_GAP) / MEDIA_BOARD_SLOT_CELL_WIDTH)),
  ));
}

/** Find the closest free anchor on the square board grid. Callers enforce their
 * item footprint and folder bounds, and must allow at least one free slot. */
export function findNearestMediaBoardGridSlot(
  initialColumn: number,
  initialRow: number,
  canPlace: (column: number, row: number) => boolean,
): { column: number; row: number } {
  if (canPlace(initialColumn, initialRow)) return { column: initialColumn, row: initialRow };

  let nearest = { column: initialColumn, row: initialRow };
  let nearestDistance = Infinity;
  const consider = (dx: number, dy: number) => {
    const distance = dx * dx + dy * dy;
    if (distance >= nearestDistance || !canPlace(initialColumn + dx, initialRow + dy)) return;
    nearest = { column: initialColumn + dx, row: initialRow + dy };
    nearestDistance = distance;
  };

  // Visit expanding perimeters, with stable ordering for equal distances. A
  // later perimeter can still beat a diagonal candidate on an earlier one.
  for (let radius = 1; radius * radius <= nearestDistance; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      consider(dx, -radius);
      consider(dx, radius);
    }
    for (let dy = -radius + 1; dy < radius; dy += 1) {
      consider(-radius, dy);
      consider(radius, dy);
    }
  }
  return nearest;
}
