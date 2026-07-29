// Analysis & Transcript Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { ToolResult } from '../types';
import { selectClipAndOpenTab } from '../aiFeedback';
import { isAIExecutionActive } from '../executionState';
import type { TimelineClip } from '../../../types/timeline';
import { collectFaceReviewCandidates } from '../../faceAnalysis/faceReviewCandidates';
import { resolveClipTranscriptWords } from '../../transcription/clipTranscriptResolver';
import { buildKeepOnlyFaceCutPlan } from './faceAnalysisCutPlan';
import { resolveFacePersonReference } from './facePersonReference';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

export function sourceTimeToTimeline(
  clip: TimelineClip,
  sourceTime: number,
  timelineStore: TimelineStore,
): number {
  if (typeof timelineStore.getSourceTimeForClip === 'function') {
    const reversed = clip.reversed === true || (clip.speed ?? 1) < 0;
    const sourceAt = (localTime: number) => {
      const offset = timelineStore.getSourceTimeForClip(clip.id, localTime);
      return reversed ? clip.outPoint - Math.abs(offset) : clip.inPoint + offset;
    };
    let bestLocal = 0;
    let bestDistance = Infinity;
    const steps = 96;
    for (let index = 0; index <= steps; index += 1) {
      const local = clip.duration * (index / steps);
      const distance = Math.abs(sourceAt(local) - sourceTime);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLocal = local;
      }
    }
    let radius = clip.duration / steps;
    for (let pass = 0; pass < 12; pass += 1) {
      const left = Math.max(0, bestLocal - radius);
      const right = Math.min(clip.duration, bestLocal + radius);
      const leftDistance = Math.abs(sourceAt(left) - sourceTime);
      const rightDistance = Math.abs(sourceAt(right) - sourceTime);
      if (leftDistance < bestDistance) {
        bestLocal = left;
        bestDistance = leftDistance;
      }
      if (rightDistance < bestDistance) {
        bestLocal = right;
        bestDistance = rightDistance;
      }
      radius /= 2;
    }
    return clip.startTime + bestLocal;
  }

  const speed = clip.speed ?? 1;
  const absoluteSpeed = Math.max(0.0001, Math.abs(speed));
  const reversed = clip.reversed === true || speed < 0;
  const local = reversed
    ? (clip.outPoint - sourceTime) / absoluteSpeed
    : (sourceTime - clip.inPoint) / absoluteSpeed;
  return clip.startTime + Math.max(0, local);
}

export async function handleGetClipAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Visual feedback: select clip and open analysis tab
  selectClipAndOpenTab(clipId, 'analysis');

  if (clip.analysisStatus !== 'ready' || !clip.analysis) {
    const error = clip.faceAnalysisStatus === 'error'
      ? clip.faceAnalysisMessage || 'YuNet + SFace analysis failed.'
      : undefined;
    return {
      success: !error,
      error,
      data: {
        hasAnalysis: false,
        status: clip.analysisStatus,
        faceAnalysisStatus: clip.faceAnalysisStatus ?? 'none',
        faceAnalysisProgress: clip.faceAnalysisProgress ?? 0,
        message: error ?? (clip.analysisStatus === 'analyzing'
          ? 'Analysis in progress'
          : 'No analysis data. Run analysis on this clip first.'),
      },
    };
  }

  const allFrames = clip.analysis.frames;
  const requestedStart = typeof args.sourceStart === 'number' ? args.sourceStart : clip.inPoint;
  const requestedEnd = typeof args.sourceEnd === 'number' ? args.sourceEnd : clip.outPoint;
  const clampSourceTime = (value: number) => Math.min(clip.outPoint, Math.max(clip.inPoint, value));
  const sourceA = clampSourceTime(requestedStart);
  const sourceB = clampSourceTime(requestedEnd);
  const sourceStart = Math.min(sourceA, sourceB);
  const sourceEnd = Math.max(sourceA, sourceB);
  const frames = allFrames.filter(frame => (
    frame.timestamp >= sourceStart && frame.timestamp <= sourceEnd
  ));
  const offset = Math.max(0, typeof args.offset === 'number' ? Math.floor(args.offset) : 0);
  const limit = Math.min(200, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 100));
  const includeFrames = args.includeFrames === true;
  const framePage = includeFrames ? frames.slice(offset, offset + limit) : [];
  const divisor = Math.max(1, frames.length);
  const avgMotion = frames.reduce((sum, f) => sum + f.motion, 0) / divisor;
  const avgBrightness = frames.reduce((sum, f) => sum + f.brightness, 0) / divisor;
  const avgFocus = frames.reduce((sum, f) => sum + (f.focus || 0), 0) / divisor;
  const totalFaces = frames.reduce((sum, f) => sum + (f.faceCount || 0), 0);
  const faceAnalysis = clip.analysis.faceAnalysis;

  return {
    success: true,
    data: {
      hasAnalysis: true,
      frameCount: allFrames.length,
      matchingFrameCount: frames.length,
      sourceRange: { start: sourceStart, end: sourceEnd },
      sampleInterval: clip.analysis.sampleInterval,
      summary: {
        averageMotion: avgMotion,
        averageBrightness: avgBrightness,
        averageFocus: avgFocus,
        maxMotion: frames.length ? Math.max(...frames.map(f => f.motion)) : 0,
        minMotion: frames.length ? Math.min(...frames.map(f => f.motion)) : 0,
        maxFocus: frames.length ? Math.max(...frames.map(f => f.focus || 0)) : 0,
        minFocus: frames.length ? Math.min(...frames.map(f => f.focus || 0)) : 0,
        faceObservations: totalFaces,
        uniquePeople: faceAnalysis?.people.length ?? 0,
      },
      frames: includeFrames
        ? framePage.map(f => ({
            time: f.timestamp,
            motion: f.motion,
            brightness: f.brightness,
            focus: f.focus || 0,
            faces: f.faceCount || 0,
          }))
        : undefined,
      pagination: {
        detailIncluded: includeFrames,
        offset,
        limit,
        returned: framePage.length,
        hasMore: includeFrames && offset + framePage.length < frames.length,
        nextOffset: includeFrames && offset + framePage.length < frames.length
          ? offset + framePage.length
          : null,
      },
      faceAnalysis: faceAnalysis
        ? {
            model: `${faceAnalysis.detector} + ${faceAnalysis.recognizer}`,
            modelVersion: faceAnalysis.modelVersion,
            backend: faceAnalysis.backend,
            uniquePeople: faceAnalysis.people.length,
            observationCount: faceAnalysis.observationCount,
          }
        : null,
    },
  };
}

export async function handleGetClipFaceAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };

  selectClipAndOpenTab(clipId, 'analysis');
  const status = clip.faceAnalysisStatus ?? 'none';
  if (status === 'error') {
    return {
      success: false,
      error: clip.faceAnalysisMessage || 'YuNet + SFace analysis failed.',
      data: { clipId, status, progress: clip.faceAnalysisProgress ?? 0 },
    };
  }
  const result = clip.analysis?.faceAnalysis;
  if (status !== 'ready' || !result) {
    return {
      success: true,
      data: {
        clipId,
        status,
        progress: clip.faceAnalysisProgress ?? 0,
        message: clip.faceAnalysisMessage
          || (status === 'analyzing'
            ? 'YuNet + SFace analysis is still running.'
            : 'No YuNet + SFace analysis exists. Call startClipFaceAnalysis first.'),
      },
    };
  }

  const requestedStart = typeof args.sourceStart === 'number' ? args.sourceStart : clip.inPoint;
  const requestedEnd = typeof args.sourceEnd === 'number' ? args.sourceEnd : clip.outPoint;
  const clampSourceTime = (value: number) => Math.min(clip.outPoint, Math.max(clip.inPoint, value));
  const sourceStart = clampSourceTime(Math.min(requestedStart, requestedEnd));
  const sourceEnd = clampSourceTime(Math.max(requestedStart, requestedEnd));
  const timelineRangeA = sourceTimeToTimeline(clip, sourceStart, timelineStore);
  const timelineRangeB = sourceTimeToTimeline(clip, sourceEnd, timelineStore);
  const timelineRange = {
    start: Math.min(timelineRangeA, timelineRangeB),
    end: Math.max(timelineRangeA, timelineRangeB),
  };
  const requestedPersonReference = typeof args.personId === 'string' ? args.personId : null;
  const personResolution = resolveFacePersonReference(requestedPersonReference, result.people);
  const requestedPersonId = personResolution.resolvedPersonId ?? requestedPersonReference;
  const includeObservations = args.includeObservations === true;
  const limit = Math.min(30, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 20));
  const reviewLimit = Math.min(
    50,
    Math.max(1, typeof args.reviewLimit === 'number' ? Math.floor(args.reviewLimit) : 30),
  );
  const people = result.people
    .filter(person => !requestedPersonId || person.id === requestedPersonId)
    .map(person => ({
      ...person,
      appearances: person.appearances
        .filter(range => range.end >= sourceStart && range.start <= sourceEnd)
        .map((range) => {
          const clippedStart = Math.max(sourceStart, range.start);
          const clippedEnd = Math.min(sourceEnd, range.end);
          const timelineA = sourceTimeToTimeline(clip, clippedStart, timelineStore);
          const timelineB = sourceTimeToTimeline(clip, clippedEnd, timelineStore);
          return {
            sourceStart: clippedStart,
            sourceEnd: clippedEnd,
            timelineStart: Math.min(timelineA, timelineB),
            timelineEnd: Math.max(timelineA, timelineB),
          };
        }),
    }))
    .filter(person => person.appearances.length > 0);
  const personLabels = new Map(result.people.map(person => [person.id, person.label]));
  const allReviewCandidates = collectFaceReviewCandidates(clip.analysis?.frames ?? []);
  const reviewCandidatesInRange = allReviewCandidates.filter(
    candidate => candidate.lastSeen >= sourceStart && candidate.firstSeen <= sourceEnd,
  );
  const reviewCandidates = reviewCandidatesInRange.slice(0, reviewLimit).map(candidate => ({
    candidateId: candidate.id,
    sourceStart: candidate.firstSeen,
    sourceEnd: candidate.lastSeen,
    timelineStart: sourceTimeToTimeline(clip, candidate.firstSeen, timelineStore),
    timelineEnd: sourceTimeToTimeline(clip, candidate.lastSeen, timelineStore),
    representativeSourceTime: candidate.sample.timestamp,
    representativeTimelineTime: sourceTimeToTimeline(clip, candidate.sample.timestamp, timelineStore),
    observationCount: candidate.observationCount,
    confidence: candidate.sample.confidence,
    box: candidate.sample.box,
  }));
  const observations = includeObservations
    ? (clip.analysis?.frames ?? [])
        .filter(frame => frame.timestamp >= sourceStart && frame.timestamp <= sourceEnd)
        .flatMap(frame => (frame.faces ?? [])
          .filter(face => !requestedPersonId || face.personId === requestedPersonId)
          .map(face => ({
            sourceTime: frame.timestamp,
            timelineTime: sourceTimeToTimeline(clip, frame.timestamp, timelineStore),
            personId: face.personId,
            label: personLabels.get(face.personId) ?? face.label,
            identityEligible: face.identityEligible !== false,
            needsReview: face.identityEligible === false,
            manuallyAssigned: Boolean(face.manualSourcePersonId),
            confidence: face.confidence,
            box: face.box,
            landmarks: face.landmarks,
          })))
        .slice(0, limit)
    : undefined;
  const keepOnlyCutPlan = requestedPersonId && people[0]
    ? buildKeepOnlyFaceCutPlan(clipId, requestedPersonId, timelineRange, people[0].appearances)
    : undefined;

  return {
    success: true,
    data: {
      clipId,
      status,
      sourceRange: { start: sourceStart, end: sourceEnd },
      timelineRange,
      personResolution: requestedPersonReference ? personResolution : undefined,
      model: {
        detector: result.detector,
        recognizer: result.recognizer,
        version: result.modelVersion,
        backend: result.backend,
      },
      summary: {
        uniquePeople: people.length,
        totalUniquePeopleInClip: result.people.length,
        observationCount: result.observationCount,
        needsReviewCandidates: reviewCandidatesInRange.length,
        totalNeedsReviewCandidatesInClip: allReviewCandidates.length,
      },
      people,
      needsReview: {
        candidates: reviewCandidates,
        candidatesInRange: reviewCandidatesInRange.length,
        totalCandidatesInClip: allReviewCandidates.length,
        limitedTo: reviewLimit,
        note: 'These are small or brief yellow detections consolidated into short visual tracks; no automatic identity is claimed.',
      },
      observations,
      observationsLimitedTo: includeObservations ? limit : undefined,
      keepOnlyCutPlan,
      correctionTools: {
        mergePeople: 'mergeClipFacePeople',
        moveAppearance: 'moveClipFaceAppearance',
        assignNeedsReview: 'assignClipFaceReviewCandidate',
      },
      editingGuidance: {
        appearanceRanges: 'Each appearance already contains timelineStart/timelineEnd mapped and clamped to this clip.',
        keepOnlyPerson: 'When personId was supplied, pass keepOnlyCutPlan.recommendedToolCall args to cutRangesFromClip unchanged. Do not split first or delete linked audio separately.',
      },
      privacy: 'Anonymous local person IDs only; raw biometric vectors are never exposed.',
    },
  };
}

export async function handleGetClipTranscript(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  // Visual feedback: select clip and open transcript tab
  selectClipAndOpenTab(clipId, 'transcript');

  const transcriptWords = resolveClipTranscriptWords(clip);
  if (!transcriptWords?.length) {
    return {
      success: true,
      data: {
        hasTranscript: false,
        message: 'No transcript available. Generate a transcript for this clip first.',
      },
    };
  }

  const requestedStart = typeof args.sourceStart === 'number' ? args.sourceStart : clip.inPoint;
  const requestedEnd = typeof args.sourceEnd === 'number' ? args.sourceEnd : clip.outPoint;
  const clampSourceTime = (value: number) => Math.min(clip.outPoint, Math.max(clip.inPoint, value));
  const sourceA = clampSourceTime(requestedStart);
  const sourceB = clampSourceTime(requestedEnd);
  const sourceStart = Math.min(sourceA, sourceB);
  const sourceEnd = Math.max(sourceA, sourceB);
  const matchingSegments = transcriptWords.filter(word => (
    word.end >= sourceStart && word.start <= sourceEnd
  ));
  const offset = Math.max(0, typeof args.offset === 'number' ? Math.floor(args.offset) : 0);
  // No upper page cap: a two-hour transcript is ~20,000 words, and a 200-word
  // ceiling made reading it whole impossible inside any sane tool budget.
  // Callers that want pages still get them by passing an explicit limit.
  const requestedLimit = typeof args.limit === 'number' ? Math.floor(args.limit) : undefined;
  const limit = requestedLimit === undefined
    ? matchingSegments.length
    : Math.max(1, requestedLimit);
  const page = matchingSegments.slice(offset, offset + limit);
  const hasMore = offset + page.length < matchingSegments.length;
  const text = page.map(word => word.text).join(' ');
  const mediaFileId = clip.source?.mediaFileId || clip.mediaFileId;
  const mediaFile = mediaFileId
    ? useMediaStore.getState().files.find(file => file.id === mediaFileId)
    : undefined;
  const fusionArtifact = mediaFile?.transcriptArtifact;
  const fusionProgress = mediaFile?.transcriptFusionProgress;

  return {
    success: true,
    data: {
      hasTranscript: true,
      segmentCount: transcriptWords.length,
      matchingSegmentCount: matchingSegments.length,
      sourceRange: { start: sourceStart, end: sourceEnd },
      offset,
      limit,
      returned: page.length,
      hasMore,
      nextOffset: hasMore ? offset + page.length : null,
      nextSourceStart: hasMore ? page.at(-1)?.end ?? sourceStart : null,
      segments: args.includeSegments === false
        ? undefined
        : page.map(word => ({
            start: word.start,
            end: word.end,
            ...(word.alignedStart !== undefined ? { alignedStart: word.alignedStart } : {}),
            ...(word.alignedEnd !== undefined ? { alignedEnd: word.alignedEnd } : {}),
            ...(word.alignmentConfidence !== undefined
              ? { alignmentConfidence: word.alignmentConfidence }
              : {}),
            text: word.text,
            speaker: word.speaker,
            speakerConfidence: word.speakerConfidence,
            speakerSourceProvider: word.speakerSourceProvider,
            sourceProvider: word.sourceProvider,
            agreement: word.agreement,
            needsReview: word.needsReview === true,
            alternatives: word.alternatives,
          })),
      text,
      fullText: text,
      fusion: fusionArtifact || fusionProgress
        ? {
            stage: fusionProgress?.stage ?? 'complete',
            providers: fusionProgress?.providers,
            openConflicts: fusionArtifact?.conflicts.filter(
              conflict => conflict.status === 'needs-review',
            ).length ?? fusionProgress?.conflictCount ?? 0,
            resolvedConflicts: fusionArtifact?.conflicts.filter(
              conflict => conflict.status !== 'needs-review',
            ).length ?? fusionProgress?.resolvedCount ?? 0,
            agentStatus: fusionArtifact?.agent.status ?? 'not-requested',
            recentPatches: fusionArtifact?.patches.slice(-8),
          }
        : null,
    },
  };
}

export async function handleFindLowQualitySections(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const metric = (args.metric as string) || 'focus';
  const threshold = (args.threshold as number) ?? 0.7;
  const minDuration = (args.minDuration as number) || 0.5;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (clip.analysisStatus !== 'ready' || !clip.analysis?.frames?.length) {
    return {
      success: false,
      error: 'No analysis data available. Run analysis on this clip first.',
    };
  }

  // Only consider frames within the clip's visible range (inPoint to outPoint)
  const sourceStart = clip.inPoint;
  const sourceEnd = clip.outPoint;
  const allFrames = clip.analysis.frames;
  const frames = allFrames.filter(f => f.timestamp >= sourceStart && f.timestamp <= sourceEnd);

  if (frames.length === 0) {
    return {
      success: true,
      data: {
        clipId,
        metric,
        threshold,
        minDuration,
        clipTimelineRange: { start: clip.startTime, end: clip.startTime + clip.duration },
        sections: [],
        totalLowQualityTime: 0,
        count: 0,
        note: 'No analysis frames within the visible clip range.',
      },
    };
  }

  const lowQualitySections: Array<{ start: number; end: number; duration: number; avgValue: number }> = [];

  // Find contiguous sections below threshold
  let sectionStart: number | null = null;
  let sectionValues: number[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const value = metric === 'focus' ? (frame.focus || 0)
                : metric === 'motion' ? frame.motion
                : frame.brightness;

    if (value < threshold) {
      if (sectionStart === null) {
        sectionStart = frame.timestamp;
      }
      sectionValues.push(value);
    } else {
      // End of low quality section
      if (sectionStart !== null) {
        const sectionEnd = frames[i - 1]?.timestamp ?? frame.timestamp;
        const sectionDuration = sectionEnd - sectionStart;
        if (sectionDuration >= minDuration) {
          lowQualitySections.push({
            start: sectionStart,
            end: sectionEnd,
            duration: sectionDuration,
            avgValue: sectionValues.reduce((a, b) => a + b, 0) / sectionValues.length,
          });
        }
        sectionStart = null;
        sectionValues = [];
      }
    }
  }

  // Handle section at the end
  if (sectionStart !== null) {
    const sectionEnd = frames[frames.length - 1].timestamp;
    const sectionDuration = sectionEnd - sectionStart;
    if (sectionDuration >= minDuration) {
      lowQualitySections.push({
        start: sectionStart,
        end: sectionEnd,
        duration: sectionDuration,
        avgValue: sectionValues.reduce((a, b) => a + b, 0) / sectionValues.length,
      });
    }
  }

  // Convert source time to timeline time
  // Source time t maps to timeline time: clip.startTime + (t - clip.inPoint)
  const timelineSections = lowQualitySections.map(s => ({
    sourceStart: s.start,
    sourceEnd: s.end,
    duration: s.duration,
    avgValue: s.avgValue,
    timelineStart: clip.startTime + (s.start - clip.inPoint),
    timelineEnd: clip.startTime + (s.end - clip.inPoint),
  }));

  // Visual feedback: highlight low quality zones on timeline
  if (isAIExecutionActive() && timelineSections.length > 0) {
    const store = (await import('../../../stores/timeline')).useTimelineStore.getState();
    for (const section of timelineSections) {
      store.addAIOverlay({
        type: 'low-quality-zone',
        trackId: clip.trackId,
        timePosition: section.timelineStart,
        width: section.duration,
        duration: 2000,
      });
    }
  }

  return {
    success: true,
    data: {
      clipId,
      metric,
      threshold,
      minDuration,
      clipTimelineRange: { start: clip.startTime, end: clip.startTime + clip.duration },
      sections: timelineSections,
      totalLowQualityTime: lowQualitySections.reduce((sum, s) => sum + s.duration, 0),
      count: lowQualitySections.length,
    },
  };
}

export { handleFindSilentSections } from './clipSilence';
export {
  handleStartClipAnalysis,
  handleStartClipFaceAnalysis,
  handleStartClipTranscription,
} from './analysisStarters';
