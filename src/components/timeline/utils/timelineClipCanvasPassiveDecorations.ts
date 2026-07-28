import { isTimelineClipCanvasAudioClip, type TimelineClipCanvasAudioClipInput } from './timelineClipCanvasAudio';
import { isSceneCutTimestampInSourceRange } from '../../../services/sceneCutDetection/sceneCutRange';
import type {
  TimelineClipCanvasWorkerAnalysisOverlayResource,
  TimelineClipCanvasWorkerPassiveBadge,
  TimelineClipCanvasWorkerPassiveDecorationsResource,
  TimelineClipCanvasWorkerProgressBar,
} from './timelineClipCanvasWorkerContract';
import {
  collectTimelineFaceIdentityRanges,
  collectTimelineFaceRanges,
  getTimelineFaceIdentityColor,
  getTimelineFaceIdentityRangeRatios,
} from './timelineFaceRangeOverlay';

export interface TimelineClipCanvasMediaStatus {
  proxyStatus?: string;
  proxyProgress?: number;
  audioProxyStatus?: string;
  audioProxyProgress?: number;
  hasProxyAudio?: boolean;
  sceneCutTimestamps?: readonly number[];
}

export interface TimelineClipCanvasTranscriptMarkerInput {
  start: number;
  end: number;
}

export interface TimelineClipCanvasAnalysisFrameInput {
  timestamp: number;
  focus?: number;
  globalMotion?: number;
  motion?: number;
  faceCount?: number;
  faces?: readonly { personId: string; identityEligible?: boolean }[];
}

export interface TimelineClipCanvasPassiveDecorationClipInput extends TimelineClipCanvasAudioClipInput {
  duration: number;
  inPoint?: number;
  outPoint?: number;
  reversed?: boolean;
  linkedGroupId?: string;
  isPendingDownload?: boolean;
  downloadProgress?: number;
  downloadError?: string;
  transcript?: readonly TimelineClipCanvasTranscriptMarkerInput[];
  transcriptStatus?: string;
  transcriptProgress?: number;
  analysis?: {
    frames?: readonly TimelineClipCanvasAnalysisFrameInput[];
    faceAnalysis?: {
      people?: readonly {
        id: string;
        appearances?: readonly { start: number; end: number }[];
      }[];
    };
  };
  analysisStatus?: string;
  analysisProgress?: number;
}

const MAX_WORKER_TRANSCRIPT_MARKERS = 512;
const MAX_WORKER_ANALYSIS_POINTS = 320;

export function getTimelineClipCanvasPassiveDecorationBadges(
  clip: TimelineClipCanvasPassiveDecorationClipInput,
  mediaStatus?: TimelineClipCanvasMediaStatus,
): TimelineClipCanvasWorkerPassiveBadge[] {
  const badges: TimelineClipCanvasWorkerPassiveBadge[] = [];

  if (clip.downloadError) {
    badges.push({ label: 'ERR', fill: 'rgba(239, 68, 68, 0.92)' });
  } else if (clip.isPendingDownload) {
    badges.push({ label: 'DL', fill: 'rgba(59, 130, 246, 0.88)' });
  }

  if (mediaStatus?.proxyStatus === 'generating') {
    badges.push({ label: 'P', fill: 'rgba(59, 130, 246, 0.9)' });
  } else if (mediaStatus?.proxyStatus === 'ready') {
    badges.push({ label: 'P', fill: 'rgba(34, 197, 94, 0.86)' });
  } else if (mediaStatus?.proxyStatus === 'error') {
    badges.push({ label: 'P!', fill: 'rgba(239, 68, 68, 0.9)' });
  }

  if (mediaStatus?.audioProxyStatus === 'generating') {
    badges.push({ label: 'A', fill: 'rgba(14, 165, 233, 0.9)' });
  } else if (mediaStatus?.audioProxyStatus === 'ready' || mediaStatus?.hasProxyAudio) {
    badges.push({ label: 'A', fill: 'rgba(34, 197, 94, 0.82)' });
  } else if (mediaStatus?.audioProxyStatus === 'error') {
    badges.push({ label: 'A!', fill: 'rgba(239, 68, 68, 0.9)' });
  }

  if (clip.transcriptStatus === 'transcribing') {
    badges.push({ label: 'T', fill: 'rgba(168, 85, 247, 0.9)' });
  } else if (clip.transcriptStatus === 'ready' && clip.transcript?.length) {
    badges.push({ label: 'T', fill: 'rgba(99, 102, 241, 0.78)' });
  }

  if (clip.analysisStatus === 'analyzing') {
    badges.push({ label: 'AN', fill: 'rgba(245, 158, 11, 0.9)' });
  } else if (clip.analysisStatus === 'ready') {
    badges.push({ label: 'AN', fill: 'rgba(20, 184, 166, 0.78)' });
  }

  if (clip.reversed) {
    badges.push({ label: 'R', fill: 'rgba(15, 23, 42, 0.86)', stroke: 'rgba(255,255,255,0.35)' });
  }
  if (clip.linkedGroupId) {
    badges.push({ label: 'L', fill: 'rgba(15, 23, 42, 0.86)', stroke: 'rgba(255,255,255,0.35)' });
  }

  return badges;
}

export function getTimelineClipCanvasPassiveDecorationBadgeReserve(
  badges: readonly TimelineClipCanvasWorkerPassiveBadge[],
): number {
  if (badges.length === 0) return 0;
  return badges.reduce((total, badge) => total + Math.max(14, badge.label.length * 6 + 8), 0) + 6;
}

export function getTimelineClipCanvasPassiveDecorationProgressBars(
  clip: TimelineClipCanvasPassiveDecorationClipInput,
  mediaStatus?: TimelineClipCanvasMediaStatus,
): TimelineClipCanvasWorkerProgressBar[] {
  const bars: TimelineClipCanvasWorkerProgressBar[] = [];
  if (clip.isPendingDownload && !clip.downloadError) {
    bars.push({ progress: clip.downloadProgress ?? 0, color: 'rgba(96, 165, 250, 0.9)' });
  }
  if (clip.transcriptStatus === 'transcribing') {
    bars.push({ progress: clip.transcriptProgress ?? 0, color: 'rgba(168, 85, 247, 0.85)' });
  }
  if (clip.analysisStatus === 'analyzing') {
    bars.push({ progress: clip.analysisProgress ?? 0, color: 'rgba(245, 158, 11, 0.9)' });
  }
  if (mediaStatus?.proxyStatus === 'generating') {
    bars.push({ progress: mediaStatus.proxyProgress ?? 0, color: 'rgba(59, 130, 246, 0.82)' });
  }
  if (mediaStatus?.audioProxyStatus === 'generating') {
    bars.push({ progress: mediaStatus.audioProxyProgress ?? 0, color: 'rgba(14, 165, 233, 0.82)' });
  }
  return bars;
}

export function hasTimelineClipCanvasPassiveDecorations(
  clip: TimelineClipCanvasPassiveDecorationClipInput,
  mediaStatus?: TimelineClipCanvasMediaStatus,
): boolean {
  return Boolean(
    clip.isPendingDownload ||
    clip.downloadError ||
    clip.linkedGroupId ||
    clip.reversed ||
    (clip.transcriptStatus && clip.transcriptStatus !== 'none') ||
    (clip.analysisStatus && clip.analysisStatus !== 'none') ||
    collectTimelineFaceRanges(clip).length > 0 ||
    mediaStatus?.proxyStatus === 'generating' ||
    mediaStatus?.proxyStatus === 'ready' ||
    mediaStatus?.proxyStatus === 'error' ||
    mediaStatus?.audioProxyStatus === 'generating' ||
    mediaStatus?.audioProxyStatus === 'ready' ||
    mediaStatus?.audioProxyStatus === 'error' ||
    mediaStatus?.hasProxyAudio ||
    (!isTimelineClipCanvasAudioClip(clip) && Boolean(mediaStatus?.sceneCutTimestamps?.length))
  );
}

export function createTimelineClipCanvasSceneCutMarkers(input: {
  clip: TimelineClipCanvasPassiveDecorationClipInput;
  mediaStatus?: TimelineClipCanvasMediaStatus;
  inPoint?: number;
  outPoint?: number;
}): Float32Array | undefined {
  const { clip, mediaStatus } = input;
  const timestamps = mediaStatus?.sceneCutTimestamps;
  if (!timestamps?.length || isTimelineClipCanvasAudioClip(clip)) return undefined;

  const inPoint = input.inPoint ?? clip.inPoint ?? 0;
  const outPoint = input.outPoint ?? clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = outPoint - inPoint;
  if (!Number.isFinite(sourceSpan) || sourceSpan <= 0) return undefined;

  const ratios: number[] = [];
  for (const timestamp of timestamps) {
    if (!isSceneCutTimestampInSourceRange(timestamp, inPoint, outPoint)) continue;
    const ratio = clip.reversed
      ? (outPoint - timestamp) / sourceSpan
      : (timestamp - inPoint) / sourceSpan;
    if (ratio > 0 && ratio < 1) ratios.push(ratio);
  }
  return ratios.length > 0 ? Float32Array.from(ratios) : undefined;
}

export function createTimelineClipCanvasWorkerTranscriptMarkers(
  clip: TimelineClipCanvasPassiveDecorationClipInput,
): Float32Array | undefined {
  const transcript = clip.transcript;
  if (!transcript || transcript.length === 0) return undefined;
  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = Math.max(0.001, outPoint - inPoint);
  const values: number[] = [];

  for (const word of transcript) {
    const wordStart = Math.max(inPoint, Math.min(outPoint, word.start));
    const wordEnd = Math.max(inPoint, Math.min(outPoint, word.end));
    if (wordEnd <= inPoint || wordStart >= outPoint || wordEnd <= wordStart) continue;
    values.push(
      clip.reversed
        ? Math.max(0, Math.min(1, (outPoint - wordEnd) / sourceSpan))
        : Math.max(0, Math.min(1, (wordStart - inPoint) / sourceSpan)),
      clip.reversed
        ? Math.max(0, Math.min(1, (outPoint - wordStart) / sourceSpan))
        : Math.max(0, Math.min(1, (wordEnd - inPoint) / sourceSpan)),
    );
    if (values.length >= MAX_WORKER_TRANSCRIPT_MARKERS * 2) break;
  }

  return values.length > 0 ? Float32Array.from(values) : undefined;
}

export function createTimelineClipCanvasWorkerAnalysisOverlay(input: {
  clip: TimelineClipCanvasPassiveDecorationClipInput;
  clipWidth: number;
}): TimelineClipCanvasWorkerAnalysisOverlayResource | undefined {
  const { clip, clipWidth } = input;
  const frames = clip.analysis?.frames;
  if (!frames || frames.length < 2 || clipWidth < 24 || isTimelineClipCanvasAudioClip(clip)) return undefined;
  if (clip.analysisStatus !== 'ready' && clip.analysisStatus !== 'analyzing') return undefined;

  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = Math.max(0.001, outPoint - inPoint);
  const visibleFrames = frames
    .filter((frame) => frame.timestamp >= inPoint && frame.timestamp <= outPoint)
    .toSorted((a, b) => a.timestamp - b.timestamp);
  if (visibleFrames.length < 2) return undefined;

  const maxPoints = Math.max(24, Math.min(MAX_WORKER_ANALYSIS_POINTS, Math.floor(clipWidth / 2)));
  const step = Math.max(1, Math.ceil(visibleFrames.length / maxPoints));
  const sampled = visibleFrames.filter((_, index) => index % step === 0);
  const lastFrame = visibleFrames[visibleFrames.length - 1];
  if (sampled[sampled.length - 1] !== lastFrame) sampled.push(lastFrame);

  const values: number[] = [];
  for (const frame of sampled) {
    const ratio = clip.reversed
      ? Math.max(0, Math.min(1, (outPoint - frame.timestamp) / sourceSpan))
      : Math.max(0, Math.min(1, (frame.timestamp - inPoint) / sourceSpan));
    values.push(
      ratio,
      Math.max(0, Math.min(1, frame.focus ?? 0)),
      Math.max(0, Math.min(1, (frame.globalMotion ?? frame.motion ?? 0) * 1.5)),
      (frame.faceCount ?? 0) > 0 ? 1 : 0,
    );
  }

  return values.length >= 8
    ? {
      kind: 'analysis-overlay',
      points: Float32Array.from(values),
      pointCount: sampled.length,
    }
    : undefined;
}

export function createTimelineClipCanvasWorkerFaceRanges(input: {
  clip: TimelineClipCanvasPassiveDecorationClipInput;
  enabled: boolean;
}): Float32Array | undefined {
  const { clip, enabled } = input;
  if (!enabled || isTimelineClipCanvasAudioClip(clip)) return undefined;

  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const ratios = getTimelineFaceIdentityRangeRatios(
    collectTimelineFaceIdentityRanges(clip),
    inPoint,
    outPoint,
    clip.reversed,
  );
  return ratios.length > 0
    ? Float32Array.from(ratios.flatMap((range) => {
      const color = getTimelineFaceIdentityColor(range.personId);
      return [range.start, range.end, ...color.rgb];
    }))
    : undefined;
}

export function createTimelineClipCanvasWorkerFaceMarkers(
  clip: TimelineClipCanvasPassiveDecorationClipInput,
): Float32Array | undefined {
  if (isTimelineClipCanvasAudioClip(clip)) return undefined;
  const frames = clip.analysis?.frames;
  if (!frames?.length) return undefined;

  const inPoint = clip.inPoint ?? 0;
  const outPoint = clip.outPoint ?? inPoint + clip.duration;
  const sourceSpan = Math.max(0.001, outPoint - inPoint);
  const values: number[] = [];
  for (const frame of frames) {
    if (frame.timestamp < inPoint || frame.timestamp > outPoint) continue;
    const ratio = clip.reversed
      ? (outPoint - frame.timestamp) / sourceSpan
      : (frame.timestamp - inPoint) / sourceSpan;
    frame.faces?.filter((face) => face.identityEligible !== false).slice(0, 3).forEach((face, index) => {
      const color = getTimelineFaceIdentityColor(face.personId);
      values.push(Math.max(0, Math.min(1, ratio)), index, ...color.rgb);
    });
  }
  return values.length > 0 ? Float32Array.from(values) : undefined;
}

export function createTimelineClipCanvasWorkerPassiveDecorationsResource(input: {
  clip: TimelineClipCanvasPassiveDecorationClipInput;
  mediaStatus?: TimelineClipCanvasMediaStatus;
  clipWidth?: number;
  showFaceRanges?: boolean;
}): TimelineClipCanvasWorkerPassiveDecorationsResource | undefined {
  const { clip, mediaStatus, clipWidth = 0, showFaceRanges = false } = input;
  const badges = getTimelineClipCanvasPassiveDecorationBadges(clip, mediaStatus);
  const progressBars = getTimelineClipCanvasPassiveDecorationProgressBars(clip, mediaStatus);
  const sceneCutMarkers = createTimelineClipCanvasSceneCutMarkers({ clip, mediaStatus });
  const transcriptMarkers = createTimelineClipCanvasWorkerTranscriptMarkers(clip);
  const faceRanges = createTimelineClipCanvasWorkerFaceRanges({ clip, enabled: showFaceRanges });
  const faceMarkers = createTimelineClipCanvasWorkerFaceMarkers(clip);
  const analysisOverlay = createTimelineClipCanvasWorkerAnalysisOverlay({ clip, clipWidth });
  if (badges.length === 0 && progressBars.length === 0 && !sceneCutMarkers && !transcriptMarkers && !faceRanges && !faceMarkers && !analysisOverlay) return undefined;
  return {
    kind: 'passive-decorations',
    badges,
    progressBars,
    sceneCutMarkers,
    transcriptMarkers,
    faceRanges,
    faceMarkers,
    analysisOverlay,
  };
}
