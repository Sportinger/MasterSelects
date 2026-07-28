import type { useTimelineStore } from '../../../stores/timeline';
import { loadAudioIntelligencePayloads } from '../../agentTimeline/artifacts/audioIntelligencePayloadLoader';
import { createCurrentAudioArtifactStore } from '../../audio/timelineWaveformPyramidCache';
import { resolveClipTranscriptWords } from '../../transcription/clipTranscriptResolver';
import { effectiveWordTiming } from '../../transcription/effectiveWordTiming';
import { isAIExecutionActive } from '../executionState';
import type { ToolResult } from '../types';
import { sourceTimeToTimeline } from './analysis';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export async function handleFindSilentSections(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const minDuration = typeof args.minDuration === 'number' && Number.isFinite(args.minDuration)
    ? Math.max(0, args.minDuration)
    : 0.5;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  const sourceStart = clip.inPoint;
  const sourceEnd = clip.outPoint;
  type SilentSection = {
    sourceStart: number;
    sourceEnd: number;
    duration: number;
    meanProbability?: number;
    rmsDb?: number;
  };
  let detectionSource: 'voice-activity' | 'rms' | 'transcript-gaps' | undefined;
  let silentSections: SilentSection[] | undefined;

  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  if (mediaFileId) {
    try {
      const artifactStore = createCurrentAudioArtifactStore();
      const artifacts = await artifactStore.listAnalysisArtifacts(mediaFileId);
      const voiceActivity = (await loadAudioIntelligencePayloads(artifacts, artifactStore)).voiceActivity;
      if (voiceActivity) {
        const speechSegments = voiceActivity.segments
          .filter(segment => segment.end > sourceStart && segment.start < sourceEnd)
          .map(segment => ({
            start: Math.max(sourceStart, segment.start),
            end: Math.min(sourceEnd, segment.end),
            confidence: segment.confidence,
          }))
          .filter(segment => segment.end > segment.start)
          .toSorted((left, right) => left.start - right.start || left.end - right.end);
        const mergedSpeech = speechSegments.reduce<typeof speechSegments>((merged, segment) => {
          const previous = merged[merged.length - 1];
          if (previous && segment.start <= previous.end) {
            previous.end = Math.max(previous.end, segment.end);
            previous.confidence = Math.max(previous.confidence, segment.confidence);
          } else merged.push({ ...segment });
          return merged;
        }, []);
        const gaps: SilentSection[] = [];
        let cursor = sourceStart;
        let previousConfidence: number | undefined;
        for (const segment of mergedSpeech) {
          if (segment.start - cursor >= minDuration) {
            const probabilities = [previousConfidence, segment.confidence]
              .filter((value): value is number => value !== undefined && Number.isFinite(value));
            gaps.push({
              sourceStart: cursor,
              sourceEnd: segment.start,
              duration: segment.start - cursor,
              ...(probabilities.length ? {
                meanProbability: probabilities.reduce((sum, value) => sum + value, 0) / probabilities.length,
              } : {}),
            });
          }
          cursor = Math.max(cursor, segment.end);
          previousConfidence = segment.confidence;
        }
        if (sourceEnd - cursor >= minDuration) {
          gaps.push({
            sourceStart: cursor,
            sourceEnd,
            duration: sourceEnd - cursor,
            ...(previousConfidence !== undefined ? { meanProbability: previousConfidence } : {}),
          });
        }
        silentSections = gaps;
        detectionSource = 'voice-activity';
      }
    } catch {
      // Missing or unreadable persisted signal data falls through to live RMS.
    }
  }

  if (!silentSections) {
    try {
      const { detectClipSilenceRanges } = await import('../../audio/audioSilenceDetection');
      const ranges = await detectClipSilenceRanges(clip, {
        minSilenceSeconds: minDuration,
        sourceOffsetSeconds: sourceStart,
      });
      silentSections = ranges.map(range => ({
        sourceStart: Math.max(sourceStart, range.start),
        sourceEnd: Math.min(sourceEnd, range.end),
        duration: Math.min(sourceEnd, range.end) - Math.max(sourceStart, range.start),
        rmsDb: range.rmsDb,
      })).filter(section => section.duration >= minDuration);
      detectionSource = 'rms';
    } catch {
      // If live audio decode is unavailable, transcript timing is the last fallback.
    }
  }

  if (!silentSections) {
    const silenceWords = resolveClipTranscriptWords(clip);
    if (!silenceWords?.length) {
      return { success: false, error: 'No voice-activity, RMS, or transcript timing data is available to analyze for silence.' };
    }
    const segments = silenceWords.map(word => effectiveWordTiming(word))
      .filter(segment => segment.end > sourceStart && segment.start < sourceEnd)
      .map(segment => ({ start: Math.max(sourceStart, segment.start), end: Math.min(sourceEnd, segment.end) }))
      .filter(segment => segment.end > segment.start)
      .toSorted((left, right) => left.start - right.start || left.end - right.end);
    const gaps: SilentSection[] = [];
    let cursor = sourceStart;
    for (const segment of segments) {
      if (segment.start - cursor >= minDuration) {
        gaps.push({ sourceStart: cursor, sourceEnd: segment.start, duration: segment.start - cursor });
      }
      cursor = Math.max(cursor, segment.end);
    }
    if (sourceEnd - cursor >= minDuration) gaps.push({ sourceStart: cursor, sourceEnd, duration: sourceEnd - cursor });
    silentSections = gaps;
    detectionSource = 'transcript-gaps';
  }

  const timelineSilentSections = silentSections.map(s => {
    const timelineA = sourceTimeToTimeline(clip, s.sourceStart, timelineStore);
    const timelineB = sourceTimeToTimeline(clip, s.sourceEnd, timelineStore);
    return {
      ...s,
      timelineStart: Math.min(timelineA, timelineB),
      timelineEnd: Math.max(timelineA, timelineB),
    };
  });

  if (isAIExecutionActive() && timelineSilentSections.length > 0) {
    const store = (await import('../../../stores/timeline')).useTimelineStore.getState();
    for (const section of timelineSilentSections) {
      store.addAIOverlay({
        type: 'silent-zone',
        trackId: clip.trackId,
        timePosition: section.timelineStart,
        width: section.timelineEnd - section.timelineStart,
        duration: 2000,
      });
    }
  }

  return {
    success: true,
    data: {
      clipId,
      minDuration,
      detectionSource,
      clipTimelineRange: { start: clip.startTime, end: clip.startTime + clip.duration },
      silentSections: timelineSilentSections,
      totalSilentTime: silentSections.reduce((sum, s) => sum + s.duration, 0),
      count: silentSections.length,
    },
  };
}
