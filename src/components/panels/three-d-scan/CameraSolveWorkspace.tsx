import {
  IconCamera,
  IconCheck,
  IconMovie,
  IconPlayerStop,
  IconRoute,
  IconSparkles,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { cameraSolvingManager } from '../../../services/photogrammetry/cameraSolvingManager';
import {
  CAMERA_SOLVE_RESOLUTION_OPTIONS,
  CAMERA_SOLVE_SAMPLING_OPTIONS,
  planCameraSolve,
  type CameraSolveResolutionPreset,
  type CameraSolveSamplingPreset,
} from '../../../services/photogrammetry/cameraSolveQuality';
import { parseSolvedCameraPath } from '../../../services/photogrammetry/cameraSolvePoses';
import {
  createCameraTrackFromSolve,
  stabilizeSourceClipFromSolve,
} from '../../../services/photogrammetry/cameraSolveTimelineOutputs';
import {
  isSupportedScanVideo,
} from '../../../services/photogrammetry/videoFrameSampler';
import { useMediaStore } from '../../../stores/mediaStore';
import { resolveMediaFileSourceFile } from '../../../stores/mediaStore/slices/fileManage/sourceResolution';
import { useTimelineStore } from '../../../stores/timeline';
import './CameraSolveWorkspace.css';

interface CameraSolveWorkspaceProps {
  active: boolean;
  onUseForSplat(): void;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatSolveDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(timestamp));
}

export function CameraSolveWorkspace({ active, onUseForSplat }: CameraSolveWorkspaceProps) {
  const mediaFiles = useMediaStore((state) => state.files);
  const timelineFrameRate = useMediaStore((state) => (
    state.compositions.find((candidate) => candidate.id === state.activeCompositionId)?.frameRate ?? 30
  ));
  const timelineClips = useTimelineStore((state) => state.clips);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore((state) => state.primarySelectedClipId);
  const job = useSyncExternalStore(
    cameraSolvingManager.subscribe,
    cameraSolvingManager.getSnapshot,
    cameraSolvingManager.getSnapshot,
  );
  const attemptedRestoreRef = useRef(false);
  const [samplingQuality, setSamplingQuality] = useState<CameraSolveSamplingPreset>('balanced');
  const [resolutionQuality, setResolutionQuality] = useState<CameraSolveResolutionPreset>('balanced');
  const [strength, setStrength] = useState(75);
  const [notice, setNotice] = useState<string | null>(null);

  const selectedTimelineVideo = useMemo(() => {
    const selected = timelineClips.filter((candidate) => selectedClipIds.has(candidate.id));
    const primary = selected.find((candidate) => candidate.id === primarySelectedClipId);
    const ordered = primary
      ? [primary, ...selected.filter((candidate) => candidate.id !== primary.id)]
      : selected;
    const clip = ordered.find((candidate) => candidate.source?.type === 'video')
      ?? ordered.find((candidate) => (
        candidate.source?.type !== 'audio'
        && candidate.file instanceof File
        && isSupportedScanVideo(candidate.file)
      ));
    if (!clip) return null;
    const mediaFileId = clip.mediaFileId ?? clip.source?.mediaFileId;
    const mediaFile = mediaFiles.find((candidate) => candidate.id === mediaFileId);
    const isVideo = mediaFile?.type === 'video'
      || clip.source?.type === 'video'
      || (clip.file instanceof File && isSupportedScanVideo(clip.file));
    return isVideo ? { clip, mediaFile } : null;
  }, [mediaFiles, primarySelectedClipId, selectedClipIds, timelineClips]);

  const solvePlan = useMemo(() => planCameraSolve(
    samplingQuality,
    resolutionQuality,
    selectedTimelineVideo
      ? Math.max(0.001, selectedTimelineVideo.clip.outPoint - selectedTimelineVideo.clip.inPoint)
      : 10,
    selectedTimelineVideo?.mediaFile?.fps ?? timelineFrameRate,
  ), [resolutionQuality, samplingQuality, selectedTimelineVideo, timelineFrameRate]);

  useEffect(() => {
    if (!active || attemptedRestoreRef.current || job.hasResult || job.isStarting) return;
    attemptedRestoreRef.current = true;
    void cameraSolvingManager.loadLatest();
  }, [active, job.hasResult, job.isStarting]);

  const dataset = job.hasResult ? cameraSolvingManager.getResult() : null;
  const solvedPath = useMemo(() => {
    if (!dataset) return null;
    try {
      return parseSolvedCameraPath(dataset);
    } catch {
      return null;
    }
  }, [dataset]);
  const solving = job.solving;
  const solvingActive = job.isStarting || Boolean(solving && ![
    'completed', 'cancelled', 'error',
  ].includes(solving.phase));
  const sampling = job.sampling;
  const busy = Boolean(sampling) || solvingActive;

  const solveSelectedClip = useCallback(async () => {
    if (!selectedTimelineVideo) {
      setNotice('Select a video clip in the timeline first.');
      return;
    }
    const { clip, mediaFile } = selectedTimelineVideo;
    const file = mediaFile ? await resolveMediaFileSourceFile(mediaFile) : clip.file;
    if (!file) {
      setNotice(`The source file for ${clip.name} is offline. Relink it in Media first.`);
      return;
    }
    setNotice(null);
    try {
      const sourceStart = Math.max(0, clip.inPoint);
      const sourceEnd = Math.max(sourceStart, clip.outPoint);
      const result = await cameraSolvingManager.startVideo({
        file,
        datasetName: `${clip.name}-camera-solve`,
        frameCount: solvePlan.frameCount,
        sourceImageMaxSide: solvePlan.sourceImageMaxSide,
        featureImageMaxSide: solvePlan.featureImageMaxSide,
        sourceStart,
        sourceEnd,
        source: {
          sourceClipId: clip.id,
          sourceClipName: clip.name,
          clipStartTime: clip.startTime,
          clipDuration: clip.duration,
          frameRate: mediaFile?.fps ?? timelineFrameRate,
        },
      });
      if (result) {
        setNotice(`Solved ${result.model.registeredSourceIndices.length} camera poses from ${solvePlan.frameCount} frames.`);
      } else {
        setNotice(cameraSolvingManager.getSnapshot().error);
      }
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setNotice(describeError(error));
    }
  }, [selectedTimelineVideo, solvePlan, timelineFrameRate]);

  const cancel = useCallback(() => {
    cameraSolvingManager.cancel();
  }, []);

  const createCameraTrack = useCallback(() => {
    const result = cameraSolvingManager.getResult();
    if (!result) return;
    try {
      const created = createCameraTrackFromSolve(result);
      setNotice(`Created a 3D camera clip with ${created.poseCount} solved poses.`);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, []);

  const applyStabilization = useCallback(() => {
    const result = cameraSolvingManager.getResult();
    if (!result) return;
    try {
      const created = stabilizeSourceClipFromSolve(result, strength);
      setNotice(`Added ${created.keyframeCount} stabilization keyframes. Undo reverts the full operation.`);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [strength]);

  return (
    <div className="camera-solve-workspace">
      <div className="camera-solve-header">
        <div>
          <strong>Camera Solve</strong>
          <span>Browser-local motion reconstruction from a timeline clip</span>
        </div>
        <button
          className="btn btn-sm"
          disabled={!selectedTimelineVideo || busy}
          onClick={() => void solveSelectedClip()}
        >
          <IconMovie size={13} /> Solve selected clip
        </button>
      </div>

      <div className="camera-solve-settings">
        <label>
          <span>Samples</span>
          <select
            value={samplingQuality}
            disabled={busy}
            onChange={(event) => setSamplingQuality(event.target.value as CameraSolveSamplingPreset)}
          >
            {CAMERA_SOLVE_SAMPLING_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Resolution</span>
          <select
            value={resolutionQuality}
            disabled={busy}
            onChange={(event) => setResolutionQuality(event.target.value as CameraSolveResolutionPreset)}
          >
            {CAMERA_SOLVE_RESOLUTION_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <span>{solvePlan.frameCount} samples - {resolutionQuality === 'full'
          ? `full source training / ${solvePlan.featureImageMaxSide}px solve`
          : `${solvePlan.featureImageMaxSide}px solve / ${solvePlan.sourceImageMaxSide}px training`}</span>
      </div>

      <div className="camera-solve-body">
        <aside className="camera-solve-sidebar">
          <div className="camera-solve-source">
            <span>Timeline source</span>
            <strong>{selectedTimelineVideo?.clip.name ?? 'No video selected'}</strong>
            <small>{selectedTimelineVideo ? `${selectedTimelineVideo.clip.duration.toFixed(1)} s - ${solvePlan.frameCount} samples` : 'Select one video clip'}</small>
          </div>
          <div className="camera-solve-flow" aria-label="Camera solve workflow">
            <div className={selectedTimelineVideo ? 'ready' : ''}><span>1</span><p><strong>Source</strong><small>Timeline clip</small></p></div>
            <div className={solvingActive ? 'active' : dataset ? 'ready' : ''}><span>2</span><p><strong>Solve</strong><small>Features and poses</small></p></div>
            <div className={dataset ? 'ready' : ''}><span>3</span><p><strong>Apply</strong><small>Camera or stabilize</small></p></div>
          </div>
        </aside>

        <main className="camera-solve-stage">
          {!dataset && !busy && !job.error && (
            <div className="camera-solve-empty">
              <IconRoute size={42} stroke={1.2} />
              <strong>Solve the motion of a timeline video</strong>
              <span>The frames and feature matching stay on this device.</span>
              <button className="btn btn-export" disabled={!selectedTimelineVideo} onClick={() => void solveSelectedClip()}>
                Solve selected clip
              </button>
            </div>
          )}

          {(busy || job.error) && (
            <section className={`scan-section scan-training ${job.error ? 'error' : solving?.phase ?? 'loading-runtime'}`}>
              <div className="scan-section-heading">
                <div>
                  <strong>{job.error ? 'Camera solving failed' : sampling ? 'Extracting video frames' : 'Solving camera motion'}</strong>
                  <span>{job.error ?? (sampling ? `${sampling.current} / ${sampling.total} frames` : solving?.message ?? 'Preparing browser vision')}</span>
                </div>
                <IconRoute size={18} />
              </div>
              <div className="scan-progress">
                <span style={{ width: `${sampling
                  ? sampling.current / Math.max(1, sampling.total) * 100
                  : solving ? solving.current / Math.max(1, solving.total) * 100 : 0}%` }} />
              </div>
              <div className="scan-metrics">
                <span><strong>{solving?.registeredImages ?? 0}</strong> cameras</span>
                <span><strong>{(solving?.pointCount ?? 0).toLocaleString()}</strong> points</span>
                <span><strong>{solving?.elapsedMs ? `${(solving.elapsedMs / 1_000).toFixed(1)} s` : '-'}</strong> elapsed</span>
              </div>
              <div className="scan-training-actions">
                {busy && <button className="btn btn-sm" onClick={cancel}><IconPlayerStop size={13} /> Cancel</button>}
                {job.error && <button className="btn btn-sm" onClick={() => cameraSolvingManager.reset()}>Reset</button>}
              </div>
            </section>
          )}

          {dataset && solvedPath && (
            <>
              <section className="scan-section camera-solve-result">
                <div className="scan-section-heading">
                  <div>
                    <strong>{dataset.source?.sourceClipName ?? dataset.model.datasetName}</strong>
                    <span>Solved {formatSolveDate(dataset.createdAt)} - {job.persistence === 'project' ? 'saved in project' : 'kept in memory'}</span>
                  </div>
                  <IconCheck size={18} />
                </div>
                <div className="camera-solve-summary">
                  <span><strong>{solvedPath.poses.length}</strong> poses</span>
                  <span><strong>{solvedPath.fovDegrees.toFixed(1)} deg</strong> vertical FOV</span>
                  <span><strong>{solvedPath.duration.toFixed(1)} s</strong> duration</span>
                </div>
              </section>

              <div className="camera-solve-output-grid">
                <section className="scan-section camera-solve-output">
                  <IconCamera size={22} />
                  <div><strong>Create 3D camera</strong><span>Adds a camera clip with position and rotation keyframes.</span></div>
                  <button className="btn btn-export" onClick={createCameraTrack}>Add camera track</button>
                </section>

                <section className="scan-section camera-solve-output">
                  <IconSparkles size={22} />
                  <div><strong>Stabilize source clip</strong><span>Adds reversible position, roll, and crop keyframes.</span></div>
                  <label className="camera-solve-strength">
                    <span>Strength</span>
                    <input type="range" min="0" max="100" value={strength} onChange={(event) => setStrength(Number(event.target.value))} />
                    <strong>{strength}%</strong>
                  </label>
                  <button className="btn btn-export" disabled={!dataset.source?.sourceClipId} onClick={applyStabilization}>
                    Stabilize timeline clip
                  </button>
                </section>
              </div>

              <button className="camera-solve-splat-link" onClick={onUseForSplat}>
                Use this solved COLMAP dataset for Gaussian Splat training
              </button>
            </>
          )}
        </main>
      </div>

      <footer className="camera-solve-footer">
        CPU / WASM solve - shared project COLMAP data - GPU is only needed for splat training
      </footer>
      {notice && <div className="scan-notice" role="status">{notice}</div>}
    </div>
  );
}
