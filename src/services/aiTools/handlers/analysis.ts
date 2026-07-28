// Analysis & Transcript Tool Handlers

import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';
import { selectClipAndOpenTab } from '../aiFeedback';
import { isAIExecutionActive } from '../executionState';
import type { TimelineClip } from '../../../types/timeline';

type TimelineStore = ReturnType<typeof useTimelineStore.getState>;

function sourceTimeToTimeline(
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

  // Summarize analysis data
  const frames = clip.analysis.frames;
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
      frameCount: frames.length,
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
      // Include detailed frame data for specific queries
      frames: frames.map(f => ({
        time: f.timestamp,
        motion: f.motion,
        brightness: f.brightness,
        focus: f.focus || 0,
        faces: f.faceCount || 0,
      })),
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
  const requestedPersonId = typeof args.personId === 'string' ? args.personId : null;
  const includeObservations = args.includeObservations === true;
  const limit = Math.min(30, Math.max(1, typeof args.limit === 'number' ? Math.floor(args.limit) : 20));
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
            confidence: face.confidence,
            box: face.box,
            landmarks: face.landmarks,
          })))
        .slice(0, limit)
    : undefined;

  return {
    success: true,
    data: {
      clipId,
      status,
      sourceRange: { start: sourceStart, end: sourceEnd },
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
      },
      people,
      observations,
      observationsLimitedTo: includeObservations ? limit : undefined,
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

  if (!clip.transcript?.length) {
    return {
      success: true,
      data: {
        hasTranscript: false,
        message: 'No transcript available. Generate a transcript for this clip first.',
      },
    };
  }

  return {
    success: true,
    data: {
      hasTranscript: true,
      segmentCount: clip.transcript.length,
      segments: clip.transcript.map(word => ({
        start: word.start,
        end: word.end,
        text: word.text,
      })),
      // Full text for easy reading
      fullText: clip.transcript.map(w => w.text).join(' '),
    },
  };
}

export async function handleFindSilentSections(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const minDuration = (args.minDuration as number) || 0.5;

  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }

  if (!clip.transcript?.length) {
    return {
      success: false,
      error: 'No transcript available to analyze for silence.',
    };
  }

  // Only consider the visible range of the clip
  const sourceStart = clip.inPoint;
  const sourceEnd = clip.outPoint;

  // Filter segments to those within the visible range
  const allSegments = clip.transcript;
  const segments = allSegments.filter(seg => seg.end > sourceStart && seg.start < sourceEnd);

  const silentSections: Array<{ sourceStart: number; sourceEnd: number; duration: number }> = [];

  // Check for silence at the beginning (from inPoint to first segment)
  const firstSegStart = segments.length > 0 ? Math.max(segments[0].start, sourceStart) : sourceEnd;
  if (firstSegStart - sourceStart >= minDuration) {
    silentSections.push({
      sourceStart: sourceStart,
      sourceEnd: firstSegStart,
      duration: firstSegStart - sourceStart,
    });
  }

  // Check gaps between segments
  for (let i = 0; i < segments.length - 1; i++) {
    const gapStart = Math.max(segments[i].end, sourceStart);
    const gapEnd = Math.min(segments[i + 1].start, sourceEnd);
    const gapDuration = gapEnd - gapStart;

    if (gapDuration >= minDuration) {
      silentSections.push({
        sourceStart: gapStart,
        sourceEnd: gapEnd,
        duration: gapDuration,
      });
    }
  }

  // Check for silence at the end (from last segment to outPoint)
  if (segments.length > 0) {
    const lastSegEnd = Math.min(segments[segments.length - 1].end, sourceEnd);
    if (sourceEnd - lastSegEnd >= minDuration) {
      silentSections.push({
        sourceStart: lastSegEnd,
        sourceEnd: sourceEnd,
        duration: sourceEnd - lastSegEnd,
      });
    }
  }

  // Convert source time to timeline time
  // Source time t maps to timeline time: clip.startTime + (t - clip.inPoint)
  const timelineSilentSections = silentSections.map(s => ({
    sourceStart: s.sourceStart,
    sourceEnd: s.sourceEnd,
    duration: s.duration,
    timelineStart: clip.startTime + (s.sourceStart - clip.inPoint),
    timelineEnd: clip.startTime + (s.sourceEnd - clip.inPoint),
  }));

  // Visual feedback: add timeline markers for silent sections
  if (isAIExecutionActive() && timelineSilentSections.length > 0) {
    const store = (await import('../../../stores/timeline')).useTimelineStore.getState();
    for (const section of timelineSilentSections) {
      store.addAIOverlay({
        type: 'silent-zone',
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
      minDuration,
      clipTimelineRange: { start: clip.startTime, end: clip.startTime + clip.duration },
      silentSections: timelineSilentSections,
      totalSilentTime: silentSections.reduce((sum, s) => sum + s.duration, 0),
      count: silentSections.length,
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

export async function handleStartClipAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(c => c.id === clipId);
  if (!clip) {
    return { success: false, error: `Clip not found: ${clipId}` };
  }
  if (!clip.file) {
    return { success: false, error: `Source file is unavailable for clip: ${clipId}` };
  }
  const isVideo = clip.file.type.startsWith('video/')
    || /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) {
    return { success: false, error: 'Clip analysis requires a video clip.' };
  }

  if (clip.analysisStatus === 'analyzing') {
    return { success: false, error: 'Analysis already in progress for this clip' };
  }

  // Visual feedback: select clip and open analysis tab
  selectClipAndOpenTab(clipId, 'analysis');

  // Import and start analysis (runs in background)
  const { analyzeClip, isAnalysisRunning, getCurrentAnalyzingClipId } = await import('../../clipAnalyzer');
  if (isAnalysisRunning()) {
    return {
      success: false,
      error: `Another clip analysis is already running (${getCurrentAnalyzingClipId() ?? 'unknown clip'}).`,
    };
  }
  void analyzeClip(clipId).catch(() => {
    // The analyzer persists its exact runtime error for getClipAnalysis.
  });

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      message: 'Analysis started, including browser-local YuNet + SFace. Poll getClipAnalysis for progress, results, or errors.',
    },
  };
}

export async function handleStartClipFaceAnalysis(
  args: Record<string, unknown>,
  timelineStore: TimelineStore,
): Promise<ToolResult> {
  const clipId = args.clipId as string;
  const clip = timelineStore.clips.find(candidate => candidate.id === clipId);
  if (!clip) return { success: false, error: `Clip not found: ${clipId}` };
  if (!clip.file) return { success: false, error: `Source file is unavailable for clip: ${clipId}` };
  const isVideo = clip.file.type.startsWith('video/')
    || /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name);
  if (!isVideo) return { success: false, error: 'YuNet + SFace analysis requires a video clip.' };

  const { analyzeClip, isAnalysisRunning, getCurrentAnalyzingClipId } = await import('../../clipAnalyzer');
  if (isAnalysisRunning()) {
    return {
      success: false,
      error: `Another clip analysis is already running (${getCurrentAnalyzingClipId() ?? 'unknown clip'}).`,
    };
  }

  selectClipAndOpenTab(clipId, 'analysis');
  void analyzeClip(clipId).catch(() => {
    // analyzeClip persists runtime errors on the clip for getClipFaceAnalysis.
  });

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      status: 'analyzing',
      message: 'YuNet + SFace analysis started in the browser. Poll getClipFaceAnalysis for progress, results, or an exact module error.',
    },
  };
}

export async function handleStartClipTranscription(
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

  // Import and start transcription (runs in background)
  const { transcribeClip } = await import('../../clipTranscriber');
  transcribeClip(clipId, 'auto'); // Don't await - runs in background

  return {
    success: true,
    data: {
      clipId,
      clipName: clip.name,
      message: 'Transcription started. Check clip details later for results.',
    },
  };
}
