import { resolveClipTranscriptWords } from '../transcription/clipTranscriptResolver';
import type { CaptionClipProperties } from '../../types/caption';
import type { TranscriptWord } from '../../types/clipMetadata';
import type { TimelineClip, TimelineTrack } from '../../types/timeline';

const CAPTION_TIME_EPSILON = 1e-6;

export interface CaptionSourceCandidate {
  clip: TimelineClip;
  words: TranscriptWord[];
}

export interface CaptionFrameToken {
  id: string;
  text: string;
  start: number;
  end: number;
  highlighted: boolean;
  active: boolean;
  progress: number;
}

export interface CaptionFrameModel {
  sourceClipId: string;
  sourceTime: number;
  cueStart: number;
  cueEnd: number;
  cueTime: number;
  cueProgress: number;
  tokens: CaptionFrameToken[];
}

export type CaptionSourceTimeResolver = (
  clip: TimelineClip,
  timelineTime: number,
) => number;

function isCaptionClip(clip: TimelineClip): boolean {
  return Boolean(clip.captionProperties);
}

function isTranscriptSourceType(clip: TimelineClip): boolean {
  return clip.source?.type === 'video' || clip.source?.type === 'audio';
}

function isClipActiveAt(clip: TimelineClip, timelineTime: number): boolean {
  return timelineTime + CAPTION_TIME_EPSILON >= clip.startTime
    && timelineTime < clip.startTime + clip.duration;
}

function getLinkedClip(clip: TimelineClip, clips: readonly TimelineClip[]): TimelineClip | undefined {
  if (clip.linkedClipId) {
    const linkedById = clips.find(candidate => candidate.id === clip.linkedClipId);
    if (linkedById) return linkedById;
  }
  return clips.find(candidate => candidate.linkedClipId === clip.id);
}

export function resolveCaptionSourceWords(
  clip: TimelineClip,
  clips: readonly TimelineClip[],
): TranscriptWord[] | undefined {
  const directWords = resolveClipTranscriptWords(clip);
  if (directWords?.length) return directWords;
  const linkedClip = getLinkedClip(clip, clips);
  const linkedWords = linkedClip ? resolveClipTranscriptWords(linkedClip) : undefined;
  return linkedWords?.length ? linkedWords : undefined;
}

function linkedPairKey(clip: TimelineClip, clips: readonly TimelineClip[]): string {
  const linkedClip = getLinkedClip(clip, clips);
  return linkedClip
    ? [clip.id, linkedClip.id].sort().join(':')
    : clip.id;
}

export function getCaptionSourceCandidates(
  clips: readonly TimelineClip[],
  captionClipId?: string,
): CaptionSourceCandidate[] {
  const candidates: CaptionSourceCandidate[] = [];
  const candidateByPair = new Map<string, number>();

  for (const clip of clips) {
    if (clip.id === captionClipId || isCaptionClip(clip) || !isTranscriptSourceType(clip)) continue;
    const words = resolveCaptionSourceWords(clip, clips);
    if (!words?.length) continue;

    const pairKey = linkedPairKey(clip, clips);
    const existingIndex = candidateByPair.get(pairKey);
    if (existingIndex === undefined) {
      candidateByPair.set(pairKey, candidates.length);
      candidates.push({ clip, words });
      continue;
    }

    // A linked video+audio import should appear as one source choice. Prefer
    // the visual clip because its timeline name/placement is what editors see.
    if (
      candidates[existingIndex].clip.source?.type === 'audio'
      && clip.source?.type === 'video'
    ) {
      candidates[existingIndex] = { clip, words };
    }
  }

  return candidates;
}

function sourceRank(
  candidate: CaptionSourceCandidate,
  tracks: readonly TimelineTrack[],
): [number, number, number] {
  const sourceTypeRank = candidate.clip.source?.type === 'video' ? 0 : 1;
  const trackIndex = tracks.findIndex(track => track.id === candidate.clip.trackId);
  return [
    sourceTypeRank,
    trackIndex < 0 ? Number.MAX_SAFE_INTEGER : trackIndex,
    -candidate.clip.startTime,
  ];
}

function compareSourceRank(
  left: CaptionSourceCandidate,
  right: CaptionSourceCandidate,
  tracks: readonly TimelineTrack[],
): number {
  const leftRank = sourceRank(left, tracks);
  const rightRank = sourceRank(right, tracks);
  for (let index = 0; index < leftRank.length; index += 1) {
    if (leftRank[index] !== rightRank[index]) return leftRank[index] - rightRank[index];
  }
  return left.clip.id.localeCompare(right.clip.id);
}

export function resolveCaptionSourceAtTime(input: {
  captionClip: TimelineClip;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  timelineTime: number;
}): CaptionSourceCandidate | null {
  const { captionClip, clips, tracks, timelineTime } = input;
  const candidates = getCaptionSourceCandidates(clips, captionClip.id);
  const requestedSourceId = captionClip.captionProperties?.sourceClipId;

  if (requestedSourceId) {
    const requested = candidates.find(candidate => candidate.clip.id === requestedSourceId);
    if (requested) {
      return isClipActiveAt(requested.clip, timelineTime) ? requested : null;
    }
  }

  return candidates
    .filter(candidate => isClipActiveAt(candidate.clip, timelineTime))
    .sort((left, right) => compareSourceRank(left, right, tracks))[0] ?? null;
}

export function defaultCaptionSourceTime(
  clip: TimelineClip,
  timelineTime: number,
): number {
  const rawSpeed = clip.speed ?? 1;
  const speed = Math.max(0.0001, Math.abs(rawSpeed));
  const reverse = Boolean(clip.reversed) !== (rawSpeed < 0);
  const elapsed = Math.max(0, timelineTime - clip.startTime) * speed;
  const sourceTime = reverse
    ? clip.outPoint - elapsed
    : clip.inPoint + elapsed;
  return Math.max(clip.inPoint, Math.min(clip.outPoint, sourceTime));
}

interface CaptionWordGroup {
  words: TranscriptWord[];
  start: number;
  end: number;
}

function getWordStart(word: TranscriptWord): number {
  return word.alignedStart ?? word.start;
}

function getWordEnd(word: TranscriptWord): number {
  return word.alignedEnd ?? word.end;
}

export function groupCaptionWords(
  words: readonly TranscriptWord[],
  properties: Pick<CaptionClipProperties, 'wordsPerCaption' | 'gapThreshold'>,
): CaptionWordGroup[] {
  const sortedWords = [...words]
    .filter(word => Number.isFinite(getWordStart(word)) && Number.isFinite(getWordEnd(word)))
    .sort((left, right) => getWordStart(left) - getWordStart(right));
  const maxWords = Math.max(1, Math.round(properties.wordsPerCaption));
  const gapThreshold = Math.max(0, properties.gapThreshold);
  const groups: CaptionWordGroup[] = [];
  let current: TranscriptWord[] = [];

  const pushCurrent = () => {
    if (current.length === 0) return;
    groups.push({
      words: current,
      start: getWordStart(current[0]),
      end: getWordEnd(current[current.length - 1]),
    });
    current = [];
  };

  for (const word of sortedWords) {
    const previous = current[current.length - 1];
    const startsNewGroup = current.length >= maxWords
      || Boolean(previous && getWordStart(word) - getWordEnd(previous) > gapThreshold);
    if (startsNewGroup) pushCurrent();
    current.push(word);
  }
  pushCurrent();

  return groups;
}

function findCaptionGroup(
  groups: readonly CaptionWordGroup[],
  sourceTime: number,
  holdAfter: number,
): CaptionWordGroup | null {
  for (let index = 0; index < groups.length; index += 1) {
    const group = groups[index];
    const nextStart = groups[index + 1]?.start ?? Number.POSITIVE_INFINITY;
    const displayEnd = Math.min(group.end + Math.max(0, holdAfter), nextStart);
    if (sourceTime + CAPTION_TIME_EPSILON >= group.start && sourceTime < displayEnd) {
      return group;
    }
  }
  return null;
}

function transformCaptionText(
  text: string,
  transform: CaptionClipProperties['textTransform'],
): string {
  if (transform === 'uppercase') return text.toLocaleUpperCase();
  if (transform === 'lowercase') return text.toLocaleLowerCase();
  if (transform === 'capitalize') {
    return text.length > 0
      ? text.charAt(0).toLocaleUpperCase() + text.slice(1).toLocaleLowerCase()
      : text;
  }
  return text;
}

export function createCaptionFrameModel(input: {
  captionClip: TimelineClip;
  clips: readonly TimelineClip[];
  tracks: readonly TimelineTrack[];
  timelineTime: number;
  resolveSourceTime?: CaptionSourceTimeResolver;
}): CaptionFrameModel | null {
  const properties = input.captionClip.captionProperties;
  if (!properties) return null;
  const source = resolveCaptionSourceAtTime(input);
  if (!source) return null;

  const sourceTime = (input.resolveSourceTime ?? defaultCaptionSourceTime)(
    source.clip,
    input.timelineTime,
  );
  const group = findCaptionGroup(
    groupCaptionWords(source.words, properties),
    sourceTime,
    properties.holdAfter,
  );
  if (!group) return null;

  const activeWordIndex = group.words.findIndex(word =>
    sourceTime + CAPTION_TIME_EPSILON >= getWordStart(word)
    && sourceTime < getWordEnd(word) + 0.08
  );

  return {
    sourceClipId: source.clip.id,
    sourceTime,
    cueStart: group.start,
    cueEnd: group.end,
    cueTime: Math.max(0, sourceTime - group.start),
    cueProgress: Math.max(
      0,
      Math.min(1, (sourceTime - group.start) / Math.max(CAPTION_TIME_EPSILON, group.end - group.start)),
    ),
    tokens: group.words.map((word, index) => {
      const active = index === activeWordIndex;
      const wordStart = getWordStart(word);
      const wordEnd = getWordEnd(word);
      const highlighted = properties.highlight.enabled && (
        properties.highlight.mode === 'caption-group'
        || (properties.highlight.mode === 'active-word' && active)
        || (
          properties.highlight.mode === 'spoken-words'
          && sourceTime + CAPTION_TIME_EPSILON >= wordStart
        )
      );
      return {
        id: word.id,
        text: transformCaptionText(word.text.trim(), properties.textTransform),
        start: wordStart,
        end: wordEnd,
        highlighted,
        active,
        progress: Math.max(
          0,
          Math.min(1, (sourceTime - wordStart) / Math.max(CAPTION_TIME_EPSILON, wordEnd - wordStart)),
        ),
      };
    }).filter(token => token.text.length > 0),
  };
}
