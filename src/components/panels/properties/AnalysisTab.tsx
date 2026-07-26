// Analysis Tab - View clip analysis data (focus, motion, faces) + AI scene descriptions
import { useMemo, useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { countSceneCutsInSourceRange } from '../../../services/sceneCutDetection/sceneCutRange';
import type { ClipAnalysis, FacePersonSummary, FrameAnalysisData, SceneSegment, SceneDescriptionStatus } from '../../../types';
import { AnalysisActionCenter } from './AnalysisActionCenter';
import { FacePeopleSummary } from './FacePeopleSummary';
import { FaceReviewSummary } from './FaceReviewSummary';

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
}

const EMPTY_FACE_PEOPLE: readonly FacePersonSummary[] = [];

function formatTimestamp(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

export function AnalysisTab({ clipId, analysis, analysisStatus, analysisProgress, clipStartTime, inPoint, outPoint, sceneDescriptions, sceneDescriptionStatus, sceneDescriptionProgress, sceneDescriptionMessage }: AnalysisTabProps) {
  const [analyzeAllRunning, setAnalyzeAllRunning] = useState(false);
  const descStatus = sceneDescriptionStatus ?? 'none';
  const descProgress = sceneDescriptionProgress ?? 0;
  const segments = useMemo(() => sceneDescriptions ?? [], [sceneDescriptions]);

  // Reactive data - subscribe to specific value only
  const playheadPosition = useTimelineStore(state => state.playheadPosition);
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
  const {
    sceneCutAnalysis,
    sceneCutStatus,
    sceneCutProgress,
  } = useMediaStore(useShallow((state) => {
    const mediaFile = state.files.find(candidate => candidate.id === sourceMediaFileId);
    return {
      sceneCutAnalysis: mediaFile?.sceneCutAnalysis,
      sceneCutStatus: mediaFile?.sceneCutStatus ?? 'none',
      sceneCutProgress: mediaFile?.sceneCutProgress ?? 0,
    };
  }));
  const facePeople = analysis?.faceAnalysis?.people ?? EMPTY_FACE_PEOPLE;
  const displayedProgress = analysisStatus === 'analyzing'
    ? analysisProgress
    : faceStatus === 'analyzing'
      ? faceProgress
      : Math.max(analysisProgress, faceProgress);
  const cutCount = useMemo(
    () => countSceneCutsInSourceRange(sceneCutAnalysis?.cuts, inPoint, outPoint),
    [inPoint, outPoint, sceneCutAnalysis],
  );
  const cutCounterText = sceneCutStatus === 'analyzing'
    ? `Analyzing ${Math.round(sceneCutProgress)}%`
    : sceneCutAnalysis
      ? String(cutCount)
      : '—';
  const handleAnalyzeSceneCuts = useCallback(() => {
    if (!sourceMediaFileId) return;
    void useMediaStore.getState().analyzeSceneCuts(sourceMediaFileId, {
      force: sceneCutStatus === 'ready'
        || sceneCutStatus === 'error'
        || Boolean(sceneCutAnalysis),
    });
  }, [sceneCutAnalysis, sceneCutStatus, sourceMediaFileId]);
  const handleCancelSceneCuts = useCallback(() => {
    if (!sourceMediaFileId) return;
    useMediaStore.getState().cancelProxyGeneration(sourceMediaFileId);
  }, [sourceMediaFileId]);
  const showSceneCutAction = Boolean(
    sourceMediaFileId
    && sceneCutStatus !== 'analyzing'
    && (sceneCutStatus === 'error' || !sceneCutAnalysis),
  );

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

    const clipEnd = clipStartTime + (outPoint - inPoint);
    if (playheadPosition < clipStartTime || playheadPosition > clipEnd) return null;

    const timeInClip = playheadPosition - clipStartTime;
    const sourceTime = inPoint + timeInClip;

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
  }, [analysis, clipStartTime, inPoint, outPoint, playheadPosition]);

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
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, {
      target: 'metrics',
      force: analysisStatus === 'ready' || analysisStatus === 'error',
    });
  }, [analysisStatus, clipId]);

  const handleAnalyzeFaces = useCallback(async () => {
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, {
      target: 'faces',
      force: faceStatus === 'ready' || faceStatus === 'error',
    });
  }, [clipId, faceStatus]);

  const handleContinue = useCallback(async () => {
    const { analyzeClip } = await import('../../../services/clipAnalyzer');
    await analyzeClip(clipId, { continueMode: true, target: 'metrics' });
  }, [clipId]);

  const handleCancel = useCallback(async () => {
    const { cancelAnalysis, isAnalysisRunning, recoverStaleAnalysis } = await import('../../../services/clipAnalyzer');
    if (!isAnalysisRunning()) {
      recoverStaleAnalysis(clipId);
      return;
    }
    cancelAnalysis();
  }, [clipId]);

  const handleClear = useCallback(async () => {
    const { clearClipAnalysis } = await import('../../../services/clipAnalyzer');
    await clearClipAnalysis(clipId);
  }, [clipId]);

  // AI scene description handlers
  const handleDescribe = useCallback(async () => {
    const { describeClip } = await import('../../../services/sceneDescriber');
    await describeClip(clipId);
  }, [clipId]);

  const handleCancelDescribe = useCallback(async () => {
    const { cancelDescription } = await import('../../../services/sceneDescriber');
    cancelDescription();
  }, []);

  const handleClearDescriptions = useCallback(async () => {
    const { clearSceneDescriptions } = await import('../../../services/sceneDescriber');
    clearSceneDescriptions(clipId);
  }, [clipId]);

  const handleAnalyzeAll = useCallback(async () => {
    if (!sourceMediaFileId || analyzeAllRunning) return;
    setAnalyzeAllRunning(true);
    try {
      const { analyzeClip } = await import('../../../services/clipAnalyzer');
      const jobs: Array<() => Promise<void>> = [
        () => analyzeClip(clipId, {
          target: 'all',
          force: analysisStatus === 'ready'
            || analysisStatus === 'error'
            || faceStatus === 'ready'
            || faceStatus === 'error',
        }),
        () => useMediaStore.getState().analyzeSceneCuts(sourceMediaFileId, {
          force: sceneCutStatus === 'ready'
            || sceneCutStatus === 'error'
            || Boolean(sceneCutAnalysis),
        }),
        async () => {
          const { describeClip } = await import('../../../services/sceneDescriber');
          await describeClip(clipId);
        },
      ];

      // Avoid multiplying decoder and GPU load. Each service owns its visible
      // error state, so one failure must not block the remaining channels.
      for (const run of jobs) {
        try {
          await run();
        } catch {
          // Continue with the next independent analysis channel.
        }
      }
    } finally {
      setAnalyzeAllRunning(false);
    }
  }, [
    analysisStatus,
    analyzeAllRunning,
    clipId,
    faceStatus,
    sceneCutAnalysis,
    sceneCutStatus,
    sourceMediaFileId,
  ]);

  const analysisActions = useMemo(() => [
    {
      id: 'metrics',
      title: 'Focus & Motion',
      detail: 'Sharpness and optical-flow samples',
      state: analysisStatus,
      statusText: analysisStatus === 'analyzing'
        ? `${analysisProgress}%`
        : analysisStatus === 'ready'
          ? `${Math.round(clipCoverage * 100)}% analyzed`
          : analysisStatus === 'error'
            ? 'Analysis failed'
            : 'Not analyzed',
      onRun: handleAnalyzeMetrics,
      onCancel: handleCancel,
      disabled: faceStatus === 'analyzing' && analysisStatus !== 'analyzing',
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
        : faceStatus === 'ready'
          ? `${facePeople.length} grouped people`
          : faceStatus === 'error'
            ? (faceMessage || 'Analysis failed')
            : 'Not analyzed',
      onRun: handleAnalyzeFaces,
      onCancel: handleCancel,
      disabled: analysisStatus === 'analyzing' && faceStatus !== 'analyzing',
    },
    {
      id: 'cuts',
      title: 'Scene Cuts',
      detail: 'Frame-accurate 160×90 source scan',
      state: sceneCutStatus,
      statusText: sceneCutStatus === 'analyzing'
        ? `${Math.round(sceneCutProgress)}%`
        : sceneCutStatus === 'ready' && sceneCutAnalysis
          ? `${sceneCutAnalysis.cuts.length} cuts`
          : sceneCutStatus === 'error'
            ? 'Analysis failed'
            : 'Not analyzed',
      onRun: handleAnalyzeSceneCuts,
      onCancel: handleCancelSceneCuts,
      disabled: !sourceMediaFileId,
    },
    {
      id: 'descriptions',
      title: 'AI Scenes',
      detail: 'Timestamped visual scene descriptions',
      state: descStatus,
      statusText: descStatus === 'describing'
        ? (sceneDescriptionMessage || `${Math.round(descProgress)}%`)
        : descStatus === 'ready'
          ? `${segments.length} described scenes`
          : descStatus === 'error'
            ? (sceneDescriptionMessage || 'Description failed')
            : 'Not analyzed',
      onRun: handleDescribe,
      onCancel: handleCancelDescribe,
    },
  ], [
    analysisProgress,
    analysisStatus,
    clipCoverage,
    descProgress,
    descStatus,
    faceMessage,
    facePeople.length,
    faceProgress,
    faceStatus,
    handleAnalyzeFaces,
    handleAnalyzeMetrics,
    handleAnalyzeSceneCuts,
    handleCancel,
    handleCancelDescribe,
    handleCancelSceneCuts,
    handleContinue,
    handleDescribe,
    isPartial,
    sceneCutAnalysis,
    sceneCutProgress,
    sceneCutStatus,
    sceneDescriptionMessage,
    segments.length,
    sourceMediaFileId,
  ]);

  // Find active scene segment at playhead
  const activeSegment = useMemo(() => {
    if (segments.length === 0) return null;
    const clipEnd = clipStartTime + (outPoint - inPoint);
    if (playheadPosition < clipStartTime || playheadPosition > clipEnd) return null;
    const sourceTime = inPoint + (playheadPosition - clipStartTime);
    return segments.find(s => sourceTime >= s.start && sourceTime < s.end) ?? null;
  }, [segments, clipStartTime, inPoint, outPoint, playheadPosition]);

  const handleSeekToSegment = useCallback((sourceTime: number) => {
    const timelinePosition = clipStartTime + (sourceTime - inPoint);
    useTimelineStore.getState().setPlayheadPosition(Math.max(0, timelinePosition));
  }, [clipStartTime, inPoint]);

  const handleSeekToSourceTime = useCallback((sourceTime: number) => {
    const clampedSourceTime = Math.max(inPoint, Math.min(outPoint, sourceTime));
    useTimelineStore.getState().setPlayheadPosition(
      Math.max(0, clipStartTime + (clampedSourceTime - inPoint)),
    );
  }, [clipStartTime, inPoint, outPoint]);

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
      {isVideoSource && (
        <AnalysisActionCenter
          actions={analysisActions}
          analyzeAllDisabled={analyzeAllRunning
            || analysisStatus === 'analyzing'
            || faceStatus === 'analyzing'
            || sceneCutStatus === 'analyzing'
            || descStatus === 'describing'}
          analyzeAllRunning={analyzeAllRunning}
          clearDisabled={analyzeAllRunning
            || analysisStatus === 'analyzing'
            || faceStatus === 'analyzing'}
          onAnalyzeAll={() => {
            void handleAnalyzeAll();
          }}
          onClearAll={handleClear}
        />
      )}

      {/* Progress */}
      {(analysisStatus === 'analyzing' || faceStatus === 'analyzing') && (
        <div className="properties-section">
          <div className="analysis-progress-bar">
            <div className="analysis-progress-fill" style={{ width: `${displayedProgress}%` }} />
          </div>
          <span className="analysis-progress-text">{displayedProgress}%</span>
          <span className="analysis-progress-text">
            {faceStatus === 'analyzing'
              ? (faceMessage || `YuNet + SFace ${faceProgress}%`)
              : `Focus & Motion ${analysisProgress}%`}
          </span>
        </div>
      )}

      {/* Current values at playhead */}
      {currentValues && (
        <div className="properties-section">
          <h4>Current Frame</h4>
          <div className="analysis-realtime-grid">
            <div className="analysis-metric">
              <span className="metric-label">Focus</span>
              <div className="metric-bar"><div className="metric-fill focus" style={{ width: `${Math.round(currentValues.focus * 100)}%` }} /></div>
              <span className="metric-value">{Math.round(currentValues.focus * 100)}%</span>
            </div>
            <div className="analysis-metric">
              <span className="metric-label">Motion</span>
              <div className="metric-bar"><div className="metric-fill motion" style={{ width: `${Math.round(currentValues.motion * 100)}%` }} /></div>
              <span className="metric-value">{Math.round(currentValues.motion * 100)}%</span>
            </div>
            {currentValues.faceCount > 0 && (
              <div className="analysis-metric">
                <span className="metric-label">Faces</span>
                <span className="metric-value">{currentValues.faceCount}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Stats summary */}
      {(stats || (isVideoSource && sourceMediaFileId)) && (
        <div className="properties-section">
          <h4>{stats ? `Summary (${stats.frameCount} frames)` : 'Summary'}</h4>
          <div className="analysis-stats-grid">
            {stats && (
              <>
                <div className="stat-row"><span>Avg Focus:</span><span>{stats.avgFocus}%</span></div>
                <div className="stat-row"><span>Peak Focus:</span><span>{stats.maxFocus}%</span></div>
                <div className="stat-row"><span>Avg Motion:</span><span>{stats.avgMotion}%</span></div>
                <div className="stat-row"><span>Peak Motion:</span><span>{stats.maxMotion}%</span></div>
              </>
            )}
            {isVideoSource && (
              <div className="stat-row">
                <span>Cuts:</span>
                <span title={sceneCutAnalysis ? `${sceneCutAnalysis.cuts.length} in source` : undefined}>
                  {showSceneCutAction ? (
                    <button
                      type="button"
                      className="btn btn-sm"
                      onClick={handleAnalyzeSceneCuts}
                    >
                      {sceneCutStatus === 'error' ? 'Retry' : 'Analyze'}
                    </button>
                  ) : cutCounterText}
                </span>
              </div>
            )}
            {stats && (
              <>
                <div className="stat-row"><span>Total Faces:</span><span>{stats.totalFaces}</span></div>
                <div className="stat-row"><span>Grouped people:</span><span>{facePeople.length}</span></div>
              </>
            )}
          </div>
        </div>
      )}

      <FacePeopleSummary
        people={facePeople}
        frames={analysis?.frames ?? []}
        sourceFile={analysisStatus === 'ready' && faceStatus === 'ready' ? sourceFile : undefined}
        onSelectSourceTime={handleSeekToSourceTime}
        onMergePeople={handleMergePeople}
        onMoveAppearance={handleMoveAppearance}
        onAssignReviewFaces={handleAssignReviewFaces}
      />

      <FaceReviewSummary
        frames={analysis?.frames ?? []}
        sourceFile={analysisStatus === 'ready' && faceStatus === 'ready' ? sourceFile : undefined}
        onSelectSourceTime={handleSeekToSourceTime}
      />

      {/* Empty state */}
      {analysisStatus !== 'ready' && analysisStatus !== 'analyzing' && !analysis?.frames.length && (
        <div className="analysis-empty-state">
          Choose an analysis above to inspect this clip.
        </div>
      )}

      {/* AI Scene Description Section */}
      <div className="properties-section" style={{ borderTop: '1px solid var(--border-color)', marginTop: '8px', paddingTop: '8px', flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
        <h4>AI Scene Description</h4>
        <div className="analysis-tab-actions">
          {descStatus !== 'ready' && descStatus !== 'describing' && (
            <button className="btn btn-sm" onClick={handleDescribe}>AI Describe</button>
          )}
          {descStatus === 'describing' && (
            <button className="btn btn-sm btn-danger" onClick={handleCancelDescribe}>Cancel</button>
          )}
          {descStatus === 'ready' && (
            <>
              <button className="btn btn-sm" onClick={handleDescribe}>Re-describe</button>
              <button className="btn btn-sm btn-danger" onClick={handleClearDescriptions}>Clear</button>
            </>
          )}
        </div>

        {/* Progress */}
        {descStatus === 'describing' && (
          <div style={{ marginTop: '6px' }}>
            <div className="analysis-progress-bar">
              <div className="analysis-progress-fill" style={{ width: `${descProgress}%` }} />
            </div>
            <span className="analysis-progress-text">
              {sceneDescriptionMessage || `${descProgress}%`}
            </span>
          </div>
        )}

        {/* Error */}
        {descStatus === 'error' && sceneDescriptionMessage && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: 'var(--danger-light)' }}>
            {sceneDescriptionMessage}
          </div>
        )}

        {/* Scene segment list */}
        {segments.length > 0 && (
          <div className="scene-segment-list" style={{
            marginTop: '6px',
            flex: 1,
            overflowY: 'auto',
            borderRadius: '4px',
            border: '1px solid var(--border-color)',
            minHeight: 0,
          }}>
            {segments.map(seg => {
              const isActive = seg.id === activeSegment?.id;
              return (
                <div
                  key={seg.id}
                  className={`scene-segment-item${isActive ? ' active' : ''}`}
                  onClick={() => handleSeekToSegment(seg.start)}
                  style={{
                    display: 'flex',
                    gap: '8px',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
                    background: isActive ? 'var(--accent-subtle)' : 'transparent',
                    borderBottom: '1px solid var(--border-color)',
                    transition: 'background 0.15s',
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)'; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                >
                  <span style={{
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '10px',
                    whiteSpace: 'nowrap',
                    paddingTop: '1px',
                    flexShrink: 0,
                  }}>
                    {formatTimestamp(seg.start)}
                  </span>
                  <span style={{
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '11px',
                    lineHeight: '1.4',
                  }}>
                    {seg.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {descStatus === 'none' && segments.length === 0 && (
          <div className="analysis-empty-state" style={{ marginTop: '4px', fontSize: '11px' }}>
            Uses local Ollama AI to describe video content with timestamps.
          </div>
        )}
      </div>
    </div>
  );
}
