// How tall each bottom sheet may be, in one place. Sheet owners do not choose a height: every sheet
// sizes to its content, and this map only sets which cap applies when it opens.
//
//   'tool'  sheets that change the picture or sound (effects, speed, crop, overlay, ...): they open at
//           most so high that the preview keeps TOOL_PREVIEW_SHARE of the visual viewport.
//   'list'  long lists, forms and management sheets (projects, library, settings, export, ...): they
//           may open up to the 'full' cap.
//   'fill'  sheets whose content scrolls itself (desktop panels, the assistant chat, All tools): they
//           always take the whole cap of their detent instead of measuring their content.
//
// The user can move every sheet between three detents with its grab handle: 'peek' (header and a
// first row), 'fit' (the cap of its size) and 'full'. Even 'full' leaves the preview at least
// MIN_PREVIEW_SHARE of the visual viewport (MIN_PREVIEW_PX on short screens), and the transport row
// (play, time, keyframe, Undo, Redo) stays docked between the preview and the sheet.

import type { PhoneSheetId } from '../contracts';

export type PhoneSheetSize = 'tool' | 'list' | 'fill';
export type PhoneSheetDetent = 'peek' | 'fit' | 'full';

export const PHONE_SHEET_SIZES: Readonly<Record<PhoneSheetId, PhoneSheetSize>> = {
  // Sheets that judge the picture or sound: the preview stays large.
  title: 'tool',
  effects: 'tool',
  filters: 'tool',
  adjust: 'tool',
  transition: 'tool',
  speed: 'tool',
  volume: 'tool',
  audio: 'tool',
  animation: 'tool',
  keyframe: 'tool',
  mask: 'tool',
  crop: 'tool',
  overlay: 'tool',
  format: 'tool',
  edits: 'tool',
  replace: 'tool',
  audioFx: 'tool',
  clipboard: 'tool',
  textMulti: 'tool',
  source: 'tool',
  audioRegion: 'tool',
  score: 'tool',
  timelineTools: 'tool',
  clipDetails: 'tool',
  bake: 'tool',
  variants: 'tool',
  'preview-view': 'tool',
  'shape-path': 'tool',
  tracks: 'tool',
  markers: 'tool',
  // Lists, forms and management sheets.
  projects: 'list',
  media: 'list',
  export: 'list',
  compositions: 'list',
  captions: 'list',
  library: 'list',
  settings: 'list',
  editors: 'list',
  mediaJobs: 'list',
  // Content that scrolls itself.
  assistant: 'fill',
  panel: 'fill',
  allTools: 'fill',
};

export const PHONE_SHEET_LAYOUT = {
  /** Share of the visual viewport the preview keeps while a 'tool' sheet is at its 'fit' detent. */
  toolPreviewShare: 0.4,
  /** Share of the visual viewport the preview keeps with any sheet at any detent. */
  minPreviewShare: 0.3,
  /** Floor for that minimum on short screens (landscape, open keyboard), in px. */
  minPreviewPx: 200,
  /** Height of the 'peek' detent (grab handle, header and a first row), in px. */
  peekPx: 176,
  /** A sheet is never capped below this (it scrolls instead), unless the screen has no room at all. */
  minSheetPx: 160,
  /** Transport row docked above an open sheet (--phone-transport-h). */
  transportPx: 48,
} as const;

export interface PhoneSheetCaps {
  peek: number;
  tool: number;
  full: number;
}

/**
 * The px caps for a visual viewport of `viewport` px whose top strips (top bar and composition tabs)
 * end at `topStrips` px. Room = what is left below the strips and the docked transport.
 */
export function phoneSheetCaps(viewport: number, topStrips: number, transport: number = PHONE_SHEET_LAYOUT.transportPx): PhoneSheetCaps {
  const room = Math.max(0, viewport - topStrips - transport);
  const floor = Math.min(PHONE_SHEET_LAYOUT.minSheetPx, room);
  const minPreview = Math.max(viewport * PHONE_SHEET_LAYOUT.minPreviewShare, PHONE_SHEET_LAYOUT.minPreviewPx);
  const full = Math.max(floor, Math.floor(room - minPreview));
  const tool = Math.min(full, Math.max(floor, Math.floor(room - viewport * PHONE_SHEET_LAYOUT.toolPreviewShare)));
  const peek = Math.min(tool, PHONE_SHEET_LAYOUT.peekPx);
  return { peek, tool, full };
}

/** The cap of one detent for a sheet of `size`. */
export function phoneSheetCap(detent: PhoneSheetDetent, size: PhoneSheetSize, caps: PhoneSheetCaps): number {
  if (detent === 'peek') return caps.peek;
  if (detent === 'full') return caps.full;
  return size === 'tool' ? caps.tool : caps.full;
}

const ORDER: readonly PhoneSheetDetent[] = ['peek', 'fit', 'full'];

/**
 * The detents that look different for this sheet, smallest first, with their heights. A sheet whose
 * content is shorter than a cap shows the same height at several detents; only the first of a run
 * of equal heights (within 4 px) is kept.
 */
export function phoneSheetStops(size: PhoneSheetSize, caps: PhoneSheetCaps, natural: number): Array<{ detent: PhoneSheetDetent; height: number }> {
  const stops: Array<{ detent: PhoneSheetDetent; height: number }> = [];
  for (const detent of ORDER) {
    const cap = phoneSheetCap(detent, size, caps);
    const height = size === 'fill' ? cap : Math.min(natural, cap);
    if (stops.length > 0 && height - stops[stops.length - 1].height <= 4) continue;
    stops.push({ detent, height });
  }
  return stops;
}

/** Where a sheet with `current` detent goes when its handle is tapped (or Enter/Space is pressed). */
export function phoneSheetToggle(current: PhoneSheetDetent, stops: ReadonlyArray<{ detent: PhoneSheetDetent }>): PhoneSheetDetent {
  if (stops.length < 2) return current;
  const index = Math.max(0, stops.findIndex((stop) => stop.detent === current));
  const largest = stops[stops.length - 1].detent;
  if (index < stops.length - 1) return largest;
  // From the largest: back to 'fit' when that is smaller, otherwise down to the smallest stop.
  const fit = stops.find((stop) => stop.detent === 'fit');
  return fit && fit.detent !== largest ? fit.detent : stops[0].detent;
}

/** One step up (+1) or down (-1) for the arrow keys; never closes. */
export function phoneSheetStep(current: PhoneSheetDetent, stops: ReadonlyArray<{ detent: PhoneSheetDetent }>, direction: 1 | -1): PhoneSheetDetent {
  const index = stops.findIndex((stop) => stop.detent === current);
  const from = index < 0 ? 0 : index;
  return stops[Math.min(stops.length - 1, Math.max(0, from + direction))]?.detent ?? current;
}

/**
 * Where a drag of the handle ends. `startHeight` and `endHeight` are the sheet heights before and at
 * release; `velocity` is px/ms, positive downwards. A downward flick or a drag down by more than 30 %
 * of the sheet from its smallest stop closes it ('close'); otherwise a flick moves one stop and a slow
 * release snaps to the nearest stop.
 */
export function phoneSheetSettle(input: {
  current: PhoneSheetDetent;
  stops: ReadonlyArray<{ detent: PhoneSheetDetent; height: number }>;
  startHeight: number;
  endHeight: number;
  velocity: number;
}): PhoneSheetDetent | 'close' {
  const { current, stops, startHeight, endHeight, velocity } = input;
  if (stops.length === 0) return current;
  const index = Math.max(0, stops.findIndex((stop) => stop.detent === current));
  const dragged = startHeight - endHeight;
  const flick = Math.abs(velocity) > 0.5 && Math.abs(dragged) > 12;
  if (flick && velocity > 0) return index === 0 ? 'close' : stops[index - 1].detent;
  if (flick && velocity < 0) return stops[Math.min(stops.length - 1, index + 1)].detent;
  if (endHeight < stops[0].height - Math.max(48, startHeight * 0.3)) return 'close';
  let best = stops[0];
  for (const stop of stops) if (Math.abs(stop.height - endHeight) < Math.abs(best.height - endHeight)) best = stop;
  return best.detent;
}

/** The detent each sheet id was left at, for the rest of the session (not persisted). */
const remembered = new Map<string, PhoneSheetDetent>();

export function rememberedPhoneSheetDetent(id: string | null): PhoneSheetDetent {
  return (id && remembered.get(id)) || 'fit';
}

export function rememberPhoneSheetDetent(id: string | null, detent: PhoneSheetDetent): void {
  if (id) remembered.set(id, detent);
}

/** For unit tests. */
export function resetRememberedPhoneSheetDetents(): void {
  remembered.clear();
}

export function phoneSheetSizeFor(id: string | null, legacyHeight: 'half' | 'tall' | undefined): PhoneSheetSize {
  if (id && Object.prototype.hasOwnProperty.call(PHONE_SHEET_SIZES, id)) return PHONE_SHEET_SIZES[id as PhoneSheetId];
  return legacyHeight === 'tall' ? 'list' : 'tool';
}

export const PHONE_SHEET_FRAME_TEST_IDS = {
  grabber: 'phone-sheet-grabber',
  /** The placeholder frame shown while a sheet's code loads (PhoneSheetHost). */
  loading: 'phone-sheet-loading',
} as const;

export const PHONE_SHEET_DETENT_LABELS: Readonly<Record<PhoneSheetDetent, string>> = {
  peek: 'small',
  fit: 'medium',
  full: 'large',
};
