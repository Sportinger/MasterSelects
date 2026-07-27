// Analysis Tab - View clip analysis data (focus, motion, faces) + AI scene descriptions
import { useMemo, useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { countSceneCutsInSourceRange } from '../../../services/sceneCutDetection/sceneCutRange';
import { estimateAgentTimelineAnalysis } from '../../../services/agentTimeline/profiles/analysisEstimate';
import { getAgentTimelineProfileSettings } from '../../../services/agentTimeline/profiles/analysisProfiles';
import type {
  AgentTimelineAnalysisEstimate,
  AgentTimelineAnalysisScopeKind,
} from '../../../types/agentTimeline/analysisEstimate';
import type { AgentTimelineJobGraphSnapshot } from '../../../types/agentTimeline/jobGraph';
import type { AgentTimelineProfile, AgentTimelineRange } from '../../../types/agentTimeline/manifest';
import type {
  ClipAnalysis,
  FacePersonSummary,
  FrameAnalysisData,
  SceneDescriptionStatus,
  SceneSegment,
  TranscriptStatus,
  TranscriptWord,
} from '../../../types/clipMetadata';
import {
  AnalysisActionCenter,
} from './AnalysisActionCenter';
import { FaceCropThumbnail } from './FaceCropThumbnail';
import { collectFaceReviewCandidates } from '../../../services/faceAnalysis/faceReviewCandidates';
import { collectFacePersonSamples, representativeFacePersonSample } from './facePersonSamples';
import {
  cancelCurrentClipAnalysis,
  runCurrentClipAnalysis,
} from '../../../services/agentTimeline/jobs/currentClipAnalysisExecution';
import { AnalysisWorkspace } from './analysisWorkspace/AnalysisWorkspace';
import { buildAnalysisWorkspaceViewModel } from './analysisWorkspace/analysisWorkspaceAdapter';
import {
  buildAnalysisWorkspaceTimelineMapping, sourceTimeForAnalysisWorkspacePlayhead, timelineTimeForAnalysisWorkspaceSource,
} from './analysisWorkspace/analysisWorkspaceOccurrenceMapping';
import {
  createAnalysisActionConfiguration,
  resolveLocalVisualExecution,
} from './analysisScopeProfileExecution';
import { TranscriptWorkspaceHeader } from './TranscriptWorkspaceHeader';
import { useTranscriptWorkspaceController } from './useTranscriptWorkspaceController';

interface AnalysisTabProps {
  clipId: string;
  analysis: ClipAnalysis | undefined;
  analysisStatus: 'none' | 'analyzing' | 'ready' | 'error';
  analysisProgress: number;
  clipStartTime: number;
  inPoint: number;
  outPoint: number;
  sceneDescriptions?: SceneSegment[];
  sceneDescriptionStatus?: SceneDescriptionStatus;
  sceneDescriptionProgress?: number;
  sceneDescriptionMessage?: string;
  transcriptStatus?: TranscriptStatus;
  transcriptProgress?: number;
  transcript?: readonly TranscriptWord[];
}

const EMPTY_FACE_PEOPLE: readonly FacePersonSummary[] = [];
const EMPTY_CLIP_KEYFRAMES = [] as const;
function graphJobText(
  graph: AgentTimelineJobGraphSnapshot | undefined,
  jobId: string,
): string | undefined {
  const status = graph?.jobs.find((job) => job.id === jobId)?.status;
  if (status === 'queued') return 'Queued';
  if (status === 'cached') return 'Cached';
  if (status === 'blocked') return 'Blocked by dependency';
  if (status === 'partial') return 'Partially complete';
  return undefined;
}

function range(start: number, end: number): AgentTimelineRange | undefined {
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? { start, end }
    : undefined;
}

function estimateProfile(profile: AgentTimelineProfile) {
  const baseline = getAgentTimelineProfileSettings(profile === 'custom' ? 'balanced' : profile);
  return profile === 'custom' ? { ...baseline, profile } : baseline;
}

export function AnalysisTab({ clipId, analysis, analysisStatus, analysisProgress, clipStartTime, inPoint, outPoint, sceneDescriptions, sceneDescriptionStatus, sceneDescriptionProgress, sceneDescriptionMessage, transcriptStatus = 'none', transcriptProgress = 0, transcript = [] }: AnalysisTabProps) {
  const [analyzeAllRunning, setAnalyzeAllRunning] = useState(false);
  const [analysisGraph, setAnalysisGraph] = useState<AgentTimelineJobGraphSnapshot>();
  const [analysisScope, setAnalysisScope] = useState<Extract<AgentTimelineAnalysisScopeKind, 'source' | 'used-ranges' | 'selection' | 'in-out'>>('used-ranges');
  const [analysisProfile, setAnalysisProfile] = useState<AgentTimelineProfile>('balanced');
  const descStatus = sceneDescriptionStatus ?? 'none';
  const descProgress = sceneDescriptionProgress ?? 0;
  const segments = useMemo(() => sceneDescriptions ?? [], [sceneDescriptions]);
  const transcriptController = useTranscriptWorkspaceController({
    clipId,
    inPoint,
    outPoint,
    transcript,
    transcriptProgress,
    transcriptStatus,
  });

  // Reactive data - subscribe to specific value only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
  const isPlaying = useTimelineStore(state => state.isPlaying);
  const isDraggingPlayhead = useTimelineStore(state => state.isDraggingPlayhead);
  const setPlayheadPosition = useTimelineStore(state => state.setPlayheadPosition);
  const selectedClip = useTimelineStore(state => state.clips.find(candidate => candidate.id === clipId));
  const clipKeyframes = useTimelineStore(state => state.clipKeyframes.get(clipId));
  const faceStatus = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.faceAnalysisStatus ?? 'none',
  );
  const faceProgress = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.faceAnalysisProgress ?? 0,
  );
  const faceMessage = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.faceAnalysisMessage,
  );
  const sourceFile = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.file,
  );
  const sourceMediaFileId = useTimelineStore((state) => {
    const clip = state.clips.find(candidate => candidate.id === clipId);
    return clip?.source?.mediaFileId ?? clip?.mediaFileId;
  });
  const isVideoSource = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.source?.type === 'video',
  );
  const isAudioSource = useTimelineStore(
    state => state.clips.find(candidate => candidate.id === clipId)?.source?.type === 'audio',
  );
  const timelineInPoint = useTimelineStore(state => state.inPoint);
  const timelineOutPoint = useTimelineStore(state => state.outPoint);
  const isSelected = useTimelineStore(state => state.selectedClipIds.has(clipId));
  const {
    sceneCutAnalysis,
    sceneCutStatus,
    sceneCutProgress,
    sourceDuration,
    transcribedRanges,
    analyzeSceneCuts,
    cancelProxyGeneration,
  } = useMediaStore(useShallow((state) => {
    const mediaFile = state.files.find(candidate => candidate.id === sourceMediaFileId);
    return {
      sceneCutAnalysis: mediaFile?.sceneCutAnalysis,
      sceneCutStatus: mediaFile?.sceneCutStatus ?? 'none',
      sceneCutProgress: mediaFile?.sceneCutProgress ?? 0,
      sourceDuration: mediaFile?.duration,
      transcribedRanges: mediaFile?.transcribedRanges,
      analyzeSceneCuts: state.analyzeSceneCuts,
      cancelProxyGeneration: state.cancelProxyGeneration,
    };
  }));
  const facePeople = analysis?.faceAnalysis?.people ?? EMPTY_FACE_PEOPLE;
  const scenePersonSamples = useMemo(() => new Map(facePeople.map((person) => [
    person.id,
    collectFacePersonSamples(analysis?.frames ?? [], person),
  ])), [analysis?.frames, facePeople]);
  const faceReviewCandidates = useMemo(
    () => collectFaceReviewCandidates(analysis?.frames ?? []),
    [analysis?.frames],
  );
  const workspaceTimelineMapping = useMemo(() => buildAnalysisWorkspaceTimelineMapping({
    clip: selectedClip, sourceId: sourceMediaFileId, keyframes: clipKeyframes ?? EMPTY_CLIP_KEYFRAMES,
  }), [clipKeyframes, selectedClip, sourceMediaFileId]);
  const sourceTimeAtPlayhead = sourceTimeForAnalysisWorkspacePlayhead(workspaceTimelineMapping, playheadPosition);
  const workspaceSourceTime = sourceTimeAtPlayhead ?? Number.NaN;
  const workspaceModel = useMemo(() => buildAnalysisWorkspaceViewModel({
    range: { inPoint, outPoint },
    analysis,
    cuts: sceneCutAnalysis?.cuts,
    sceneSegments: segments,
    transcript,
    channels: {
      cuts: { status: sceneCutStatus, measuredRanges: sceneCutStatus === 'ready' && sceneCutAnalysis ? [{ start: 0, end: sceneCutAnalysis.duration }] : undefined },
      metrics: { status: analysisStatus },
      faces: { status: faceStatus },
      transcript: { status: transcriptStatus, measuredRanges: transcribedRanges?.map(([start, end]) => ({ start, end })) },
      descriptions: { status: descStatus, measuredRanges: descStatus === 'ready' ? [{ start: inPoint, end: outPoint }] : undefined },
      ...(isAudioSource ? {
        audio: { status: transcriptStatus, measuredRanges: transcribedRanges?.map(([start, end]) => ({ start, end })) },
      } : {}),
    },
  }), [analysis, analysisStatus, descStatus, faceStatus, inPoint, isAudioSource, outPoint, sceneCutAnalysis, sceneCutStatus, segments, transcript, transcriptStatus, transcribedRanges]);
  const cutCount = useMemo(
    () => countSceneCutsInSourceRange(sceneCutAnalysis?.cuts, inPoint, outPoint),
    [inPoint, outPoint, sceneCutAnalysis],
  );
  const cutCounterText = sceneCutStatus === 'analyzing'
    ? `Analyzing ${Math.round(sceneCutProgress)}%`
    : sceneCutAnalysis
      ? String(cutCount)
      : '—';
  const usedRange = useMemo(() => range(inPoint, outPoint), [inPoint, outPoint]);
  const fullSourceRange = useMemo(() => range(
    0,
    sourceDuration ?? 0,
  ), [sourceDuration]);
  const inOutRange = useMemo(() => {
    if (timelineInPoint === null || timelineOutPoint === null || !usedRange) return undefined;
    const timelineStart = Math.min(timelineInPoint, timelineOutPoint);
    const timelineEnd = Math.max(timelineInPoint, timelineOutPoint);
    const sourceStart = inPoint + Math.max(0, timelineStart - clipStartTime);
    const sourceEnd = inPoint + Math.max(0, timelineEnd - clipStartTime);
    return range(
      Math.max(usedRange.start, sourceStart),
      Math.min(usedRange.end, sourceEnd),
    );
  }, [clipStartTime, inPoint, timelineInPoint, timelineOutPoint, usedRange]);
  const scopeRanges = useMemo(() => ({
    source: fullSourceRange ? [fullSourceRange] : undefined,
    'used-ranges': usedRange ? [usedRange] : undefined,
    selection: isSelected && usedRange ? [usedRange] : undefined,
    'in-out': inOutRange ? [inOutRange] : undefined,
  }), [fullSourceRange, inOutRange, isSelected, usedRange]);
  const { localVisual, blockedReason: localVisualBlockedReason } = useMemo(() => (
    resolveLocalVisualExecution(analysisScope, analysisProfile, scopeRanges)
  ), [analysisProfile, analysisScope, scopeRanges]);
  const analysisEstimate = useMemo<AgentTimelineAnalysisEstimate | undefined>(() => {
    const sourceRanges = scopeRanges[analysisScope];
    if (!sourceRanges) return undefined;
    const sourceFrameRate = sceneCutAnalysis && sceneCutAnalysis.duration > 0
      ? sceneCutAnalysis.sourceFrameCount / sceneCutAnalysis.duration
      : undefined;
    const cachedCoverage = [
      ...(sceneCutStatus === 'ready' && sceneCutAnalysis && fullSourceRange
        ? [{ channel: 'cuts' as const, ranges: [fullSourceRange] }]
        : []),
      ...(analysisStatus === 'ready' && usedRange
        ? [{ channel: 'quality' as const, ranges: [usedRange] }]
        : []),
      ...(faceStatus === 'ready' && usedRange
        ? [{ channel: 'people' as const, ranges: [usedRange] }]
        : []),
      ...(transcriptStatus === 'ready' && usedRange
        ? [{ channel: 'speech' as const, ranges: [usedRange] }]
        : []),
    ];
    return estimateAgentTimelineAnalysis({
      scope: { kind: analysisScope, sourceRanges },
      profile: estimateProfile(analysisProfile),
      channels: isAudioSource
        ? ['speech', 'audio']
        : ['cuts', 'quality', 'people', 'speech'],
      cachedCoverage,
      sourceFrameRate,
      shotCount: sceneCutAnalysis ? sceneCutAnalysis.cuts.length + 1 : undefined,
    });
  }, [analysisProfile, analysisScope, analysisStatus, faceStatus, fullSourceRange, isAudioSource, sceneCutAnalysis, sceneCutStatus, scopeRanges, transcriptStatus, usedRange]);
  const analysisConfiguration = useMemo(() => createAnalysisActionConfiguration({
    scope: analysisScope,
    profile: analysisProfile,
    scopeRanges,
    estimate: analysisEstimate,
    isSelected,
    hasInOutRange: Boolean(inOutRange),
    blockedReason: localVisualBlockedReason,
    onScopeChange: setAnalysisScope,
    onProfileChange: setAnalysisProfile,
  }), [analysisEstimate, analysisProfile, analysisScope, inOutRange, isSelected, localVisualBlockedReason, scopeRanges]);
  const handleAnalyzeSceneCuts = useCallback(() => {
    if (!sourceMediaFileId) return;
    void analyzeSceneCuts(sourceMediaFileId, {
      force: sceneCutStatus === 'ready'
        || sceneCutStatus === 'error'
        || Boolean(sceneCutAnalysis),
    });
  }, [analyzeSceneCuts, sceneCutAnalysis, sceneCutStatus, sourceMediaFileId]);
  const handleCancelSceneCuts = useCallback(() => {
    if (cancelCurrentClipAnalysis(clipId, localVisual)) return;
    if (!sourceMediaFileId) return;
    cancelProxyGeneration(sourceMediaFileId);
  }, [cancelProxyGeneration, clipId, localVisual, sourceMediaFileId]);
  // A page reload ends the in-memory analysis job but can leave its durable
  // clip state marked as "analyzing". Recover it when the tab remounts so the
  // user is never left with a non-functional Cancel button.
  useEffect(() => {
    if (analysisStatus !== 'analyzing' && faceStatus !== 'analyzing') return;

    let disposed = false;
    void import('../../../services/clipAnalyzer').then(({ isAnalysisRunning, recoverStaleAnalysis }) => {
      if (!disposed && !isAnalysisRunning()) {
        recoverStaleAnalysis(clipId);
      }
    });
    return () => {
      disposed = true;
    };
  }, [analysisStatus, clipId, faceStatus]);

  // Calculate current values at playhead
  const currentValues = useMemo((): FrameAnalysisData | null => {
    if (!analysis?.frames.length) return null;

    if (sourceTimeAtPlayhead === undefined) return null;
    const sourceTime = sourceTimeAtPlayhead;

    let closestFrame = analysis.frames[0];
    let closestDistance = Math.abs(closestFrame.timestamp - sourceTime);

    for (const frame of analysis.frames) {
      const distance = Math.abs(frame.timestamp - sourceTime);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestFrame = frame;
      }
    }
    return closestFrame;
  }, [analysis, sourceTimeAtPlayhead]);

  // Stats summary
  const stats = useMemo(() => {
    if (!analysis?.frames.length) return null;
    const frames = analysis.frames;
    return {
      avgFocus: Math.round(frames.reduce((s, f) => s + f.focus, 0) / frames.length * 100),
      avgMotion: Math.round(frames.reduce((s, f) => s + f.motion, 0) / frames.length * 100),
      maxFocus: Math.round(Math.max(...frames.map(f => f.focus)) * 100),
      maxMotion: Math.round(Math.max(...frames.map(f => f.motion)) * 100),
      totalFaces: frames.reduce((s, f) => s + f.faceCount, 0),
      frameCount: frames.length,
    };
  }, [analysis]);

  // Calculate coverage of clip's range from analysis frames
  const clipCoverage = useMemo(() => {
    if (!analysis?.frames.length) return 0;
    const clipDuration = outPoint - inPoint;
    if (clipDuration <= 0) return 0;
    const sampleIntervalSec = (analysis.sampleInterval || 500) / 1000;
    const framesInRange = analysis.frames.filter(
      (f: FrameAnalysisData) => f.timestamp >= inPoint - 0.01 && f.timestamp <= outPoint + 0.01
    );
    return Math.min(1, (framesInRange.length * sampleIntervalSec) / clipDuration);
  }, [analysis, inPoint, outPoint]);

  const isPartial = analysisStatus === 'ready' && clipCoverage < 0.98;

  const handleAnalyzeMetrics = useCallback(async () => {
    if (!localVisual) return;
    const profile = getAgentTimelineProfileSettings(localVisual.profile);
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, {
      target: 'metrics',
      force: analysisStatus === 'ready' || analysisStatus === 'error',
      sourceRange: localVisual.sourceRange,
      sampleIntervalMs: 1000 / profile.metricSamplesPerSecond,
    });
  }, [analysisStatus, clipId, localVisual]);

  const handleAnalyzeFaces = useCallback(async () => {
    if (!localVisual?.includeFaces) return;
    const profile = getAgentTimelineProfileSettings(localVisual.profile);
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, {
      target: 'faces',
      force: faceStatus === 'ready' || faceStatus === 'error',
      sourceRange: localVisual.sourceRange,
      faceSampleIntervalMs: 1000 / profile.faceSamplesPerSecond,
    });
  }, [clipId, faceStatus, localVisual]);

  const handleContinue = useCallback(async () => {
    if (!localVisual) return;
    const profile = getAgentTimelineProfileSettings(localVisual.profile);
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, {
      continueMode: true,
      target: 'metrics',
      sourceRange: localVisual.sourceRange,
      sampleIntervalMs: 1000 / profile.metricSamplesPerSecond,
    });
  }, [clipId, localVisual]);

  const handleCancel = useCallback(async () => {
    if (cancelCurrentClipAnalysis(clipId, localVisual)) return;
    const { cancelAnalysis, isAnalysisRunning, recoverStaleAnalysis } = await import('../../../services/clipAnalyzer');
    if (!isAnalysisRunning()) {
      recoverStaleAnalysis(clipId);
      return;
    }
    cancelAnalysis();
  }, [clipId, localVisual]);

  const handleClear = useCallback(async () => {
    const { clearClipAnalysis } = await import('../../../services/clipAnalyzer');
    await clearClipAnalysis(clipId);
  }, [clipId]);

  const handleClearAll = useCallback(async () => {
    if (isAudioSource) {
      const { clearClipTranscript } = await import('../../../services/clipTranscriber');
      clearClipTranscript(clipId);
      return;
    }
    await handleClear();
  }, [clipId, handleClear, isAudioSource]);

  // AI scene description handlers
  const handleDescribe = useCallback(async () => {
    const { describeClip } = await import('../../../services/sceneDescriber');
    await describeClip(clipId);
  }, [clipId]);

  const handleCancelDescribe = useCallback(async () => {
    if (cancelCurrentClipAnalysis(clipId, localVisual)) return;
    const { cancelDescription } = await import('../../../services/sceneDescriber');
    cancelDescription();
  }, [clipId, localVisual]);

  const handleCancelTranscriptAction = useCallback(() => {
    if (!cancelCurrentClipAnalysis(clipId, localVisual)) transcriptController.onCancel();
  }, [clipId, localVisual, transcriptController]);

  const handleAnalyzeAll = useCallback(async () => {
    if (analyzeAllRunning || !localVisual) return;
    setAnalysisGraph(undefined);
    setAnalyzeAllRunning(true);
    try {
      await runCurrentClipAnalysis({ clipId, localVisual, onUpdate: setAnalysisGraph });
    } finally {
      setAnalyzeAllRunning(false);
    }
  }, [
    analyzeAllRunning,
    clipId,
    localVisual,
  ]);
  const visualGraphText = graphJobText(analysisGraph, 'visual');
  const cutsGraphText = graphJobText(analysisGraph, 'cuts');
  const transcriptGraphText = graphJobText(analysisGraph, 'transcript');
  const descriptionsGraphText = graphJobText(analysisGraph, 'descriptions');

  const analysisActions = useMemo(() => [
    {
      id: 'metrics',
      title: 'Focus & Motion',
      detail: 'Sharpness and optical-flow samples',
      state: analysisStatus,
      statusText: analysisStatus === 'analyzing'
        ? `${analysisProgress}%`
        : analyzeAllRunning && visualGraphText
          ? visualGraphText
        : analysisStatus === 'ready'
          ? `${Math.round(clipCoverage * 100)}% analyzed`
          : analysisStatus === 'error'
            ? 'Analysis failed'
            : 'Not analyzed',
      onRun: handleAnalyzeMetrics,
      onCancel: handleCancel,
      disabled: Boolean(localVisualBlockedReason)
        || analyzeAllRunning
        || (faceStatus === 'analyzing' && analysisStatus !== 'analyzing'),
      secondaryAction: isPartial
        ? { label: 'Continue', onClick: handleContinue }
        : undefined,
    },
    {
      id: 'faces',
      title: 'Faces',
      detail: 'YuNet detection and SFace grouping',
      state: faceStatus,
      statusText: faceStatus === 'analyzing'
        ? (faceMessage || `${faceProgress}%`)
        : !localVisual?.includeFaces
          ? 'Unavailable for source scope'
        : analyzeAllRunning && visualGraphText
          ? visualGraphText
        : faceStatus === 'ready'
          ? `${facePeople.length} grouped people`
          : faceStatus === 'error'
            ? (faceMessage || 'Analysis failed')
            : 'Not analyzed',
      onRun: handleAnalyzeFaces,
      onCancel: handleCancel,
      disabled: Boolean(localVisualBlockedReason)
        || !localVisual?.includeFaces
        || analyzeAllRunning
        || (analysisStatus === 'analyzing' && faceStatus !== 'analyzing'),
    },
    {
      id: 'cuts',
      title: 'Scene Cuts',
      detail: 'Frame-accurate 160×90 source scan',
      state: sceneCutStatus,
      statusText: sceneCutStatus === 'analyzing'
        ? `${Math.round(sceneCutProgress)}%`
        : analyzeAllRunning && cutsGraphText
          ? cutsGraphText
        : sceneCutStatus === 'ready' && sceneCutAnalysis
          ? `${sceneCutAnalysis.cuts.length} cuts`
          : sceneCutStatus === 'error'
            ? 'Analysis failed'
            : 'Not analyzed',
      onRun: handleAnalyzeSceneCuts,
      onCancel: handleCancelSceneCuts,
      disabled: analyzeAllRunning || !sourceMediaFileId,
    },
    {
      id: 'transcript',
      title: 'Transcript',
      detail: 'Timed words and diarized speakers',
      state: transcriptStatus,
      statusText: transcriptStatus === 'transcribing'
        ? `${Math.round(transcriptProgress)}%`
        : analyzeAllRunning && transcriptGraphText
          ? transcriptGraphText
        : transcriptStatus === 'ready'
          ? `${transcript.length} words`
          : transcriptStatus === 'error'
            ? 'Transcription failed'
            : 'Not transcribed',
      onRun: transcriptController.onTranscribe,
      onCancel: handleCancelTranscriptAction,
      disabled: analyzeAllRunning,
    },
    {
      id: 'descriptions',
      title: 'AI Scenes',
      detail: 'Timestamped visual scene descriptions',
      state: descStatus,
      statusText: descStatus === 'describing'
        ? (sceneDescriptionMessage || `${Math.round(descProgress)}%`)
        : analyzeAllRunning && descriptionsGraphText
          ? descriptionsGraphText
        : descStatus === 'ready'
          ? `${segments.length} described scenes`
          : descStatus === 'error'
            ? (sceneDescriptionMessage || 'Description failed')
            : 'Not analyzed',
      onRun: handleDescribe,
      onCancel: handleCancelDescribe,
      disabled: analyzeAllRunning,
    },
  ], [
    analysisProgress,
    analysisStatus,
    analyzeAllRunning,
    clipCoverage,
    cutsGraphText,
    descProgress,
    descStatus,
    descriptionsGraphText,
    faceMessage,
    facePeople.length,
    faceProgress,
    faceStatus,
    handleAnalyzeFaces,
    handleAnalyzeMetrics,
    handleAnalyzeSceneCuts,
    handleCancel,
    handleCancelDescribe,
    handleCancelTranscriptAction,
    handleCancelSceneCuts,
    handleContinue,
    handleDescribe,
    transcriptController.onTranscribe,
    isPartial,
    localVisual,
    localVisualBlockedReason,
    sceneCutAnalysis,
    sceneCutProgress,
    sceneCutStatus,
    sceneDescriptionMessage,
    segments.length,
    sourceMediaFileId,
    transcriptProgress,
    transcriptStatus,
    transcript.length,
    transcriptGraphText,
    visualGraphText,
  ]);
  const visibleAnalysisActions = isVideoSource
    ? analysisActions
    : analysisActions.filter((action) => action.id === 'transcript');

  const handleSeekToSourceTime = useCallback((sourceTime: number) => {
    const timelineTime = timelineTimeForAnalysisWorkspaceSource(workspaceTimelineMapping, sourceTime);
    if (timelineTime !== undefined) setPlayheadPosition(Math.max(0, timelineTime));
  }, [setPlayheadPosition, workspaceTimelineMapping]);

  const handleMergePeople = useCallback((sourcePersonId: string, targetPersonId: string) => {
    void import('../../../services/faceAnalysis/faceIdentityCorrections').then(({ mergeFacePeople }) => (
      mergeFacePeople(clipId, sourcePersonId, targetPersonId)
    ));
  }, [clipId]);

  const handleMoveAppearance = useCallback((sourcePersonId: string, targetPersonId: string, sourceTime: number) => {
    void import('../../../services/faceAnalysis/faceIdentityCorrections').then(({ moveFaceAppearance }) => (
      moveFaceAppearance(clipId, sourcePersonId, targetPersonId, sourceTime)
    ));
  }, [clipId]);

  const handleAssignReviewFaces = useCallback((candidateId: string, faceIds: string[], targetPersonId: string) => {
    void import('../../../services/faceAnalysis/faceIdentityCorrections').then(({ assignReviewFaces }) => (
      assignReviewFaces(clipId, candidateId, faceIds, targetPersonId)
    ));
  }, [clipId]);

  return (
    <div className="properties-tab-content analysis-tab" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {(isVideoSource || isAudioSource) && (
        <AnalysisActionCenter
          actions={visibleAnalysisActions}
          configuration={analysisConfiguration}
          analyzeAllDisabled={analyzeAllRunning
            || Boolean(localVisualBlockedReason)
            || analysisStatus === 'analyzing'
            || faceStatus === 'analyzing'
            || sceneCutStatus === 'analyzing'
            || descStatus === 'describing'
            || transcriptStatus === 'transcribing'}
          analyzeAllRunning={analyzeAllRunning}
          clearDisabled={analyzeAllRunning
            || analysisStatus === 'analyzing'
            || faceStatus === 'analyzing'}
          onAnalyzeAll={() => {
            void handleAnalyzeAll();
          }}
          onClearAll={handleClearAll}
        />
      )}

      {workspaceTimelineMapping.status === 'mapping-unavailable' && <p role="status">mapping-unavailable: {workspaceTimelineMapping.reason}</p>}
      <AnalysisWorkspace
        model={workspaceModel}
        sourceTime={workspaceSourceTime}
        isFollowingPlayback={isPlaying || isDraggingPlayhead}
        transcriptSearchQuery={transcriptController.searchQuery}
        onTranscriptSearchChange={transcriptController.onSearchChange}
        transcriptControls={(
          <TranscriptWorkspaceHeader
            activeProvider={transcriptController.activeProvider}
            clipCoverage={transcriptController.clipCoverage}
            hasTranscript={transcript.length > 0}
            isPartial={transcriptController.isPartial}
            isSignedIn={transcriptController.isSignedIn}
            language={transcriptController.language}
            onCancel={transcriptController.onCancel}
            onContinue={transcriptController.onContinue}
            onDelete={transcriptController.onClear}
            onLanguageChange={transcriptController.onLanguageChange}
            onProviderChange={transcriptController.onProviderChange}
            onSearchChange={transcriptController.onSearchChange}
            onTranscribe={transcriptController.onTranscribe}
            run={transcriptController.run}
            searchQuery={transcriptController.searchQuery}
            summary={transcriptController.summary}
            transcriptProgress={transcriptProgress}
            transcriptStatus={transcriptStatus}
          />
        )}
        currentFrame={currentValues ? {
          sourceTime: workspaceSourceTime,
          focus: currentValues.focus,
          motion: currentValues.motion,
          faceCount: currentValues.faceCount,
        } : undefined}
        summary={{
          ...(stats ? {
            frameCount: stats.frameCount,
            averageFocus: stats.avgFocus,
            peakFocus: stats.maxFocus,
            averageMotion: stats.avgMotion,
            peakMotion: stats.maxMotion,
            totalFaces: stats.totalFaces,
          } : {}),
          groupedPeople: facePeople.length,
          ...(isVideoSource ? {
            cutCount,
            totalSourceCuts: sceneCutAnalysis?.cuts.length,
            cutStatusText: cutCounterText,
          } : {}),
          transcriptWords: transcript.length,
          describedScenes: segments.length,
        }}
        reviewCandidates={faceReviewCandidates}
        facePeople={facePeople}
        faceFrames={analysis?.frames ?? []}
        faceSourceFile={analysisStatus === 'ready' && faceStatus === 'ready' ? sourceFile : undefined}
        onSeekSourceTime={handleSeekToSourceTime}
        onMergePeople={handleMergePeople}
        onMoveAppearance={handleMoveAppearance}
        onAssignReviewFaces={handleAssignReviewFaces}
        onReanalyzeDescription={() => {
          void handleDescribe();
        }}
        renderPersonThumbnail={(person, _scene, requestedTime) => {
          const personSamples = scenePersonSamples.get(person.id) ?? [];
          // List avatars deliberately reuse one representative crop per
          // identity. Scene-specific crops are only needed for an explicit
          // appearance click, otherwise a long list would enqueue a new video
          // seek for the same speaker in every scene.
          const sample = requestedTime === undefined
            ? representativeFacePersonSample(personSamples)
            : personSamples.reduce<(typeof personSamples)[number] | undefined>((closest, candidate) => (
              !closest || Math.abs(candidate.timestamp - requestedTime) < Math.abs(closest.timestamp - requestedTime)
                ? candidate
                : closest
            ), undefined);
          return (
            <FaceCropThumbnail
              file={analysisStatus === 'ready' && faceStatus === 'ready' ? sourceFile : undefined}
              sample={sample}
              size={42}
              alt={`${person.label} face`}
            />
          );
        }}
        renderReviewThumbnail={(candidate) => (
          <FaceCropThumbnail
            file={analysisStatus === 'ready' && faceStatus === 'ready' ? sourceFile : undefined}
            sample={candidate.sample}
            size={42}
            alt={`Face needing review at ${candidate.sample.timestamp.toFixed(1)} seconds`}
          />
        )}
      />

    </div>
  );
}
