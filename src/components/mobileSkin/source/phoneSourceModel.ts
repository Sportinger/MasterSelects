// Pure rules of the phone source monitor ('source' sheet): frame <-> time for the marks, the seven
// placement modes of the editor (timelinePlacementCommands) with what each needs, and the plain-words
// line that previews where a mode puts the source. No React, no stores: unit-tested on its own.
import type { TimelinePlacementMode } from '../../../stores/timeline/editOperations/types';
import type { TimelineToolPreview } from '../../../stores/timeline/types';

export const PHONE_SOURCE_DEFAULT_FPS = 30;

/** The modes the phone offers, in the order a person thinks of them. 'position-overwrite' is a desktop pointer tool. */
export type PhoneSourceMode = Exclude<TimelinePlacementMode, 'position-overwrite'>;

export interface PhoneSourceModeInfo {
  id: PhoneSourceMode;
  label: string;
  detail: string;
  /** Needs a selected clip (or a range) on the timeline as its target. */
  needsTarget: boolean;
}

export const PHONE_SOURCE_MODES: readonly PhoneSourceModeInfo[] = [
  { id: 'insert', label: 'Insert', detail: 'At the playhead; later clips move right', needsTarget: false },
  { id: 'overwrite', label: 'Overwrite', detail: 'At the playhead; covers what is there', needsTarget: false },
  { id: 'append-at-end', label: 'Append', detail: 'After the last clip of the track', needsTarget: false },
  { id: 'place-on-top', label: 'On top', detail: 'At the playhead on a free track above', needsTarget: false },
  { id: 'replace', label: 'Replace', detail: 'Swaps the selected clip, keeps its length', needsTarget: true },
  { id: 'fit-to-fill', label: 'Fit to fill', detail: 'Fills the selected clip; speed adapts', needsTarget: true },
  { id: 'ripple-overwrite', label: 'Ripple overwrite', detail: 'Replaces the selected clip; later clips follow', needsTarget: true },
];

export const PHONE_SOURCE_TARGET_REASON =
  'This mode replaces a clip: select the clip on the timeline first (or tap "Use the clip under the playhead").';

export function phoneSourceFps(fps: number | undefined): number {
  return Number.isFinite(fps) && fps !== undefined && fps > 0 ? fps : PHONE_SOURCE_DEFAULT_FPS;
}

/** Frame shown at `time` (frame-code rule: floor with a tiny tolerance). */
export function phoneSourceFrameAt(time: number, fps: number): number {
  return Math.max(0, Math.floor(time * fps + 1e-6));
}

/** Seek target that shows `frame` without landing on a boundary: the middle of the frame. */
export function phoneSourceSeekTime(frame: number, fps: number): number {
  return (Math.max(0, frame) + 0.5) / fps;
}

export function phoneSourceFrameCount(duration: number | undefined, fps: number): number {
  return Number.isFinite(duration) && duration !== undefined && duration > 0 ? Math.max(1, Math.round(duration * fps)) : 0;
}

/** Marks are frames: In is the first frame used, Out the last one (inclusive). */
export interface PhoneSourceMarks {
  inFrame: number | null;
  outFrame: number | null;
}

/** Store values (seconds) for marks: In starts at its frame, Out ends after its frame. */
export function phoneSourceMarkTimes(marks: PhoneSourceMarks, fps: number): { inPoint: number | null; outPoint: number | null } {
  return {
    inPoint: marks.inFrame === null ? null : marks.inFrame / fps,
    outPoint: marks.outFrame === null ? null : (marks.outFrame + 1) / fps,
  };
}

/** Marks from the store values (inverse of phoneSourceMarkTimes). */
export function phoneSourceMarksFromTimes(inPoint: number | null, outPoint: number | null, fps: number): PhoneSourceMarks {
  return {
    inFrame: inPoint === null ? null : Math.round(inPoint * fps),
    outFrame: outPoint === null ? null : Math.max(0, Math.round(outPoint * fps) - 1),
  };
}

/** Clamps a typed or tapped mark into the source and keeps In <= Out. */
export function clampPhoneSourceMark(kind: 'in' | 'out', frame: number, marks: PhoneSourceMarks, frameCount: number): PhoneSourceMarks {
  const last = Math.max(0, frameCount - 1);
  const value = Math.min(last, Math.max(0, Math.round(Number.isFinite(frame) ? frame : 0)));
  if (kind === 'in') {
    return { inFrame: value, outFrame: marks.outFrame !== null && marks.outFrame < value ? value : marks.outFrame };
  }
  return { inFrame: marks.inFrame !== null && marks.inFrame > value ? value : marks.inFrame, outFrame: value };
}

/** "Frames 30–59 · 30 frames (1.00 s)", or the whole source without marks. */
export function describePhoneSourceRange(marks: PhoneSourceMarks, frameCount: number, fps: number): string {
  if (frameCount <= 0) return 'Still image: placed with its default length.';
  if (marks.inFrame === null && marks.outFrame === null) return `Whole source · ${frameCount} frames (${(frameCount / fps).toFixed(2)} s)`;
  const first = marks.inFrame ?? 0;
  const last = marks.outFrame ?? frameCount - 1;
  const count = Math.max(1, last - first + 1);
  return `Frames ${first}–${last} · ${count} frames (${(count / fps).toFixed(2)} s)`;
}

export function formatPhoneSourceTime(seconds: number): string {
  const safe = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${(safe - minutes * 60).toFixed(2).padStart(5, '0')}`;
}

const AFTER_EFFECT: Record<PhoneSourceMode, string> = {
  insert: 'later clips move right',
  overwrite: 'what was there is covered',
  'append-at-end': 'nothing else moves',
  'place-on-top': 'nothing below changes',
  replace: 'the old clip is replaced',
  'fit-to-fill': 'the source speed adapts to the length',
  'ripple-overwrite': 'later clips follow the new length',
};

/** One line that says where the mode puts the source (from the editor's own placement preview). */
export function describePhoneSourcePreview(
  mode: PhoneSourceMode,
  preview: TimelineToolPreview | null,
  trackName: (trackId: string) => string,
): { ok: boolean; text: string } {
  if (!preview) return { ok: false, text: 'Nothing to place.' };
  if (preview.blocked || preview.startTime === undefined || preview.endTime === undefined || !preview.trackId) {
    return { ok: false, text: preview.message ?? 'This mode cannot place the source here.' };
  }
  const label = PHONE_SOURCE_MODES.find((entry) => entry.id === mode)?.label ?? mode;
  return {
    ok: true,
    text: `${label}: ${formatPhoneSourceTime(preview.startTime)}–${formatPhoneSourceTime(preview.endTime)} on ${trackName(preview.trackId)}; ${AFTER_EFFECT[mode]}.`,
  };
}
