// Read-only views the phone Captions sheet builds from the shared editor state: the speech sources
// of the timeline with their transcript state, the caption clips, and the captions (word groups)
// of one caption clip on the timeline - grouped exactly like the caption renderer groups them.

import { resolveCaptionSourceWords } from '../../../services/captions/captionRuntime';
import type { CaptionTimelineTranscriptEvent, CaptionTimelineWordEvent } from '../../../services/captions/captionTimelineTranscript';
import type { TranscriptStatus } from '../../../types/clipMetadata';
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';

export interface PhoneSpeechSource {
  clipId: string;
  name: string;
  startTime: number;
  duration: number;
  status: TranscriptStatus;
  progress: number;
  message: string | null;
  wordCount: number;
  /** The clip carries a playable file the transcriber can read. */
  hasFile: boolean;
}

export interface PhoneCaptionGroup {
  key: string;
  start: number;
  end: number;
  words: CaptionTimelineWordEvent[];
}

function isSpeechSourceType(clip: TimelineClip): boolean {
  return !clip.captionProperties && (clip.source?.type === 'video' || clip.source?.type === 'audio');
}

function linkedOf(clip: TimelineClip, clips: readonly TimelineClip[]): TimelineClip | undefined {
  return clip.linkedClipId ? clips.find((candidate) => candidate.id === clip.linkedClipId) : clips.find((candidate) => candidate.linkedClipId === clip.id);
}

/** One entry per spoken source; a linked video and its sound count once (the video, as on the desktop). */
export function listPhoneSpeechSources(clips: readonly TimelineClip[], tracks: readonly Pick<TimelineTrack, 'id' | 'type'>[]): PhoneSpeechSource[] {
  const trackIds = new Set(tracks.map((track) => track.id));
  const seen = new Set<string>();
  const sources: PhoneSpeechSource[] = [];
  const ordered = clips.filter((clip) => trackIds.has(clip.trackId) && isSpeechSourceType(clip))
    .toSorted((left, right) => (left.source?.type === 'video' ? 0 : 1) - (right.source?.type === 'video' ? 0 : 1) || left.startTime - right.startTime);
  for (const clip of ordered) {
    if (seen.has(clip.id)) continue;
    const linked = linkedOf(clip, clips);
    seen.add(clip.id);
    if (linked) seen.add(linked.id);
    const carrier = clip.transcriptStatus && clip.transcriptStatus !== 'none' ? clip : linked?.transcriptStatus ? linked : clip;
    const words = resolveCaptionSourceWords(clip, clips)?.length ?? 0;
    sources.push({
      clipId: clip.id,
      name: clip.name,
      startTime: clip.startTime,
      duration: clip.duration,
      status: words > 0 && carrier.transcriptStatus !== 'transcribing' ? 'ready' : carrier.transcriptStatus ?? 'none',
      progress: carrier.transcriptProgress ?? 0,
      message: carrier.transcriptMessage ?? null,
      wordCount: words,
      hasFile: Boolean(clip.file && clip.file.size > 0) || Boolean(linked?.file && linked.file.size > 0),
    });
  }
  return sources.toSorted((left, right) => left.startTime - right.startTime);
}

export function listPhoneCaptionClips(clips: readonly TimelineClip[]): TimelineClip[] {
  return clips.filter((clip) => clip.captionProperties).toSorted((left, right) => left.startTime - right.startTime);
}

/** Captions as the viewer sees them: at most `wordsPerCaption` words, a new caption after a pause or a source change. */
export function groupPhoneCaptionEvents(
  events: readonly CaptionTimelineTranscriptEvent[],
  wordsPerCaption: number,
  gapThreshold: number,
): PhoneCaptionGroup[] {
  const maxWords = Math.max(1, Math.round(wordsPerCaption));
  const gap = Math.max(0, gapThreshold);
  const groups: PhoneCaptionGroup[] = [];
  let current: CaptionTimelineWordEvent[] = [];
  const push = () => {
    if (current.length === 0) return;
    groups.push({ key: current[0].key, start: current[0].timelineStart, end: current[current.length - 1].timelineEnd, words: current });
    current = [];
  };
  for (const event of events) {
    if (event.kind !== 'word') continue;
    const previous = current[current.length - 1];
    if (current.length >= maxWords || (previous && (event.sourceClipId !== previous.sourceClipId || event.timelineStart - previous.timelineEnd > gap))) push();
    current.push(event);
  }
  push();
  return groups;
}

export function formatPhoneCaptionTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const minutes = Math.floor(safe / 60);
  const rest = safe - minutes * 60;
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`;
}

/** The single word the editor accepts per timing slot: trimmed, no inner spaces. */
export function validatePhoneCaptionWord(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return 'A word cannot be empty. Use Cut word to remove it from the video.';
  if (/\s/u.test(trimmed)) return 'One word per slot: the timing belongs to a single word.';
  return null;
}
