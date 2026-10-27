// Bar and beat lines of the editor's tempo map for the phone ruler's visible window, thinned to
// bar lines when beats would crowd the ruler at the current phone zoom.

import { iterateBarBeatLines } from '../../../timeline/tempo/TempoMap';
import { normalizeTempoMap } from '../../../timeline/tempo/tempoEdits';
import type { PhoneTimeWindow } from './phoneTimelineGeometry';

/** Beats closer than this on screen are thinned to bar lines only. */
const MIN_BEAT_PX = 8;
const MAX_MARKS = 400;

export interface PhoneBeatMark { time: number; downbeat: boolean }

/** Bar/beat lines inside the window; beats are dropped when they would crowd the ruler. */
export function phoneBeatMarks(tempoMap: Parameters<typeof normalizeTempoMap>[0], timeWindow: PhoneTimeWindow, zoom: number): PhoneBeatMark[] {
  const map = normalizeTempoMap(tempoMap);
  const lines = iterateBarBeatLines(map, Math.max(0, timeWindow.start), Math.max(0, timeWindow.end));
  let marks = lines.map((line) => ({ time: line.time, downbeat: line.isBarStart }));
  const beatPx = map.events.reduce((min, event) => Math.min(min, (60 / Math.max(1, event.bpm)) * zoom), Infinity);
  if (beatPx < MIN_BEAT_PX) marks = marks.filter((mark) => mark.downbeat);
  return marks.slice(0, MAX_MARKS);
}
