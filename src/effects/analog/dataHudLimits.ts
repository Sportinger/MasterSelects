/** Data HUD recipe limits shared by the effect definition (inspector, tool notes) and its graph. */
export const DATA_HUD_SIZE_RANGE = [20, 600] as const;
/** Boxes and text blocks: whole counts up to this many. */
export const DATA_HUD_BOX_RANGE = [0, 3] as const;
/** Small marks: whole counts up to this many. */
export const DATA_HUD_MARK_RANGE = [0, 4] as const;
export const DATA_HUD_LINE_RANGE = [1, 12] as const;
export const DATA_HUD_TEXT_RANGE = [6, 60] as const;
export const DATA_HUD_RATE_RANGE = [0, 60] as const;
export const DATA_HUD_SEED_RANGE = [0, 9999] as const;
/** Characters of the label atlas: digits, x and y (glyph indices 0-9, 10, 11), then capitals and signs for text blocks. */
export const DATA_HUD_LABEL_CHARACTERS = '0123456789xyABCDEFGHIJKLMNOPQRSTUVWXYZ.:-/';
/** Glyph index of the first capital in DATA_HUD_LABEL_CHARACTERS, and the number of capitals. */
export const DATA_HUD_FIRST_CAPITAL = 12;
export const DATA_HUD_CAPITALS = 26;
/** Label layout "x ddd y dddd": twelve character slots. */
export const DATA_HUD_LABEL_SLOTS = 12;
/** Character width of the monospace label as a share of Text Size. */
export const DATA_HUD_CHARACTER_WIDTH = .62;
