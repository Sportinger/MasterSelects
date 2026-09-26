import type { MidiClipData } from '../../../types/midiClip';
import type { TimelineClipCanvasWorkerPreparedClipResources } from './timelineClipCanvasWorkerModel';

const MIDI_PREVIEW_MIN_BAR_WIDTH = 1.5;
const MIDI_PREVIEW_MIN_BAR_HEIGHT = 2;
const MIDI_PREVIEW_MAX_BAR_HEIGHT = 9;
const MIDI_PREVIEW_VERTICAL_INSET = 2;
const MIDI_PREVIEW_DIRECT_NOTE_LIMIT = 512;
const MIDI_PREVIEW_MAX_AGGREGATED_BARS = 1536;
const MIDI_PREVIEW_MAX_X_BUCKETS = 96;
const MIDI_PREVIEW_PITCH_PADDING = 2;

export type TimelineClipCanvasWorkerMidiPreviewResource = NonNullable<
  TimelineClipCanvasWorkerPreparedClipResources['midiPreview']
>;

export interface TimelineClipCanvasMidiResourceClipInput {
  trackType?: 'video' | 'audio' | 'midi' | 'score';
  duration: number;
  inPoint?: number;
  outPoint?: number;
  midiData?: MidiClipData;
  source?: {
    type?: string | null;
  } | null;
}

interface VisibleMidiNote {
  pitch: number;
  start: number;
  duration: number;
  end: number;
  velocity?: number;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function isTimelineClipCanvasMidiClip(clip: TimelineClipCanvasMidiResourceClipInput): boolean {
  return clip.source?.type === 'midi' || clip.trackType === 'midi';
}

function collectVisibleMidiNotes(input: {
  clip: TimelineClipCanvasMidiResourceClipInput;
  sourceIn: number;
  sourceOut: number;
  visibleSourceStart: number;
  visibleSourceEnd: number;
}): readonly VisibleMidiNote[] {
  const notes = input.clip.midiData?.notes ?? [];
  const visibleNotes: VisibleMidiNote[] = [];
  for (const note of notes) {
    const pitch = note.pitch;
    const start = note.start;
    const duration = Math.max(0.001, note.duration);
    const end = start + duration;
    if (
      !Number.isFinite(pitch) ||
      !Number.isFinite(start) ||
      !Number.isFinite(duration) ||
      end <= input.sourceIn ||
      start >= input.sourceOut ||
      end <= input.visibleSourceStart ||
      start >= input.visibleSourceEnd
    ) {
      continue;
    }
    visibleNotes.push({ pitch, start, duration, end, velocity: note.velocity });
  }
  return visibleNotes;
}

export function createTimelineClipCanvasWorkerMidiPreviewResource(
  clip: TimelineClipCanvasMidiResourceClipInput,
  clipWidth: number,
  bodyHeight: number,
  visibleStartRatio = 0,
  visibleEndRatio = 1,
): TimelineClipCanvasWorkerMidiPreviewResource | undefined {
  const notes = clip.midiData?.notes;
  if (!isTimelineClipCanvasMidiClip(clip) || !notes || notes.length === 0 || clipWidth < 2 || bodyHeight < 6) {
    return undefined;
  }

  const sourceIn = clip.inPoint ?? 0;
  const sourceOut = Math.max(sourceIn + 0.001, clip.outPoint ?? sourceIn + clip.duration);
  const sourceSpan = Math.max(0.001, sourceOut - sourceIn);
  const startRatio = clampUnit(visibleStartRatio);
  const endRatio = Math.max(startRatio, clampUnit(visibleEndRatio));
  const visibleSourceStart = sourceIn + sourceSpan * startRatio;
  const visibleSourceEnd = sourceIn + sourceSpan * endRatio;
  const visibleNotes = collectVisibleMidiNotes({ clip, sourceIn, sourceOut, visibleSourceStart, visibleSourceEnd });
  if (visibleNotes.length === 0) return undefined;

  const minPitch = Math.min(...visibleNotes.map((note) => note.pitch));
  const maxPitch = Math.max(...visibleNotes.map((note) => note.pitch));
  if (!Number.isFinite(minPitch) || !Number.isFinite(maxPitch)) return undefined;

  const usableHeight = Math.max(1, bodyHeight - MIDI_PREVIEW_VERTICAL_INSET * 2);
  const pitchMin = minPitch - MIDI_PREVIEW_PITCH_PADDING;
  const pitchMax = maxPitch + MIDI_PREVIEW_PITCH_PADDING;
  const pitchSpan = Math.max(1, pitchMax - pitchMin);
  const xForSourceTime = (sourceTime: number) => ((sourceTime - sourceIn) / sourceSpan) * clipWidth;

  if (visibleNotes.length <= MIDI_PREVIEW_DIRECT_NOTE_LIMIT) {
    const barHeight = Math.min(
      MIDI_PREVIEW_MAX_BAR_HEIGHT,
      Math.max(MIDI_PREVIEW_MIN_BAR_HEIGHT, usableHeight / pitchSpan),
    );
    const bars = new Float32Array(visibleNotes.length * 5);
    visibleNotes.forEach((note, index) => {
      const noteStartX = Math.max(0, xForSourceTime(Math.max(note.start, sourceIn)));
      const noteEndX = Math.min(clipWidth, xForSourceTime(Math.min(note.end, sourceOut)));
      const rawWidth = Math.max(0.001, noteEndX - noteStartX);
      const offset = index * 5;
      bars[offset] = noteStartX;
      bars[offset + 1] = Math.max(
        0,
        Math.min(
          bodyHeight - barHeight,
          MIDI_PREVIEW_VERTICAL_INSET + (1 - clampUnit((note.pitch - pitchMin) / pitchSpan)) * usableHeight - barHeight / 2,
        ),
      );
      bars[offset + 2] = rawWidth > MIDI_PREVIEW_MIN_BAR_WIDTH + 1
        ? Math.max(MIDI_PREVIEW_MIN_BAR_WIDTH, rawWidth - 1)
        : Math.max(MIDI_PREVIEW_MIN_BAR_WIDTH, rawWidth);
      bars[offset + 3] = barHeight;
      bars[offset + 4] = 0.45 + clampUnit(note.velocity ?? 0.8) * 0.45;
    });
    return { kind: 'midi-preview', bars, barCount: visibleNotes.length, mode: 'notes' };
  }

  const visibleClipStartX = startRatio * clipWidth;
  const visibleClipEndX = Math.max(visibleClipStartX + 1, endRatio * clipWidth);
  const visibleClipWidth = Math.max(1, visibleClipEndX - visibleClipStartX);
  const basePitchBucketCount = Math.max(4, Math.min(64, Math.floor(usableHeight / 1.5)));
  const cappedXBucketCount = Math.max(1, Math.min(MIDI_PREVIEW_MAX_X_BUCKETS, Math.ceil(visibleClipWidth / 2)));
  const xBucketCount = Math.max(
    1,
    Math.min(cappedXBucketCount, Math.floor(MIDI_PREVIEW_MAX_AGGREGATED_BARS / basePitchBucketCount)),
  );
  const pitchBucketCount = Math.max(
    1,
    Math.min(basePitchBucketCount, Math.floor(MIDI_PREVIEW_MAX_AGGREGATED_BARS / xBucketCount)),
  );
  const bucketWidth = visibleClipWidth / xBucketCount;
  const bucketHeight = usableHeight / pitchBucketCount;
  const buckets = new Float32Array(xBucketCount * pitchBucketCount);

  for (const note of visibleNotes) {
    const startX = Math.max(visibleClipStartX, xForSourceTime(Math.max(note.start, sourceIn, visibleSourceStart)));
    const endX = Math.min(visibleClipEndX, xForSourceTime(Math.min(note.end, sourceOut, visibleSourceEnd)));
    const startBucket = Math.max(0, Math.min(xBucketCount - 1, Math.floor((startX - visibleClipStartX) / bucketWidth)));
    const endBucket = Math.max(
      startBucket,
      Math.min(xBucketCount - 1, Math.floor((Math.max(startX + 0.001, endX) - visibleClipStartX) / bucketWidth)),
    );
    const pitchBucket = Math.max(
      0,
      Math.min(pitchBucketCount - 1, Math.floor(clampUnit((note.pitch - pitchMin) / pitchSpan) * pitchBucketCount)),
    );
    const alpha = 0.22 + clampUnit(note.velocity ?? 0.8) * 0.38;
    for (let xBucket = startBucket; xBucket <= endBucket; xBucket += 1) {
      const index = xBucket * pitchBucketCount + pitchBucket;
      buckets[index] = Math.min(1, buckets[index] + alpha);
    }
  }

  const barCount = buckets.reduce((count, alpha) => count + (alpha > 0 ? 1 : 0), 0);
  if (barCount === 0) return undefined;

  const bars = new Float32Array(barCount * 5);
  let barIndex = 0;
  for (let xBucket = 0; xBucket < xBucketCount; xBucket += 1) {
    for (let pitchBucket = 0; pitchBucket < pitchBucketCount; pitchBucket += 1) {
      const alpha = buckets[xBucket * pitchBucketCount + pitchBucket];
      if (alpha <= 0) continue;
      const offset = barIndex * 5;
      bars[offset] = visibleClipStartX + xBucket * bucketWidth;
      bars[offset + 1] = MIDI_PREVIEW_VERTICAL_INSET + (pitchBucketCount - 1 - pitchBucket) * bucketHeight;
      bars[offset + 2] = Math.max(1, bucketWidth);
      bars[offset + 3] = Math.max(1, bucketHeight - 0.4);
      bars[offset + 4] = Math.min(0.92, 0.28 + alpha * 0.58);
      barIndex += 1;
    }
  }
  return { kind: 'midi-preview', bars, barCount, mode: 'density' };
}
