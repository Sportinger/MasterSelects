import {
  IconAlertTriangle,
  IconBox,
  IconCheck,
  IconFolderOpen,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react';
import {
  BRUSH_RUNTIME_COMPRESSED_ESTIMATE_BYTES,
  formatScanBytes,
  getCheckingScanGpuCapability,
  probeScanGpuCapability,
  type ScanGpuCapability,
} from '../../../services/photogrammetry/scanCapability';
import {
  analyzeScanImages,
  mergeScanSourceFiles,
  type ScanImageAnalysis,
} from '../../../services/photogrammetry/scanSourceAnalysis';
import {
  inspectColmapDataset,
  type ColmapDatasetInspection,
} from '../../../services/photogrammetry/colmapDataset';
import {
  extractColmapDatasetArchive,
  isColmapDatasetArchive,
} from '../../../services/photogrammetry/colmapDatasetArchive';
import { createColmapSparsePreviewSplat } from '../../../services/photogrammetry/colmapSparsePreview';
import { createVirtualDirectoryHandle } from '../../../services/photogrammetry/virtualDirectoryHandle';
import { cameraSolvingManager } from '../../../services/photogrammetry/cameraSolvingManager';
import type { CameraSolveSourceContext } from '../../../services/photogrammetry/cameraSolvingContract';
import {
  type BrushTrainingPreset,
  type BrushTrainingSnapshot,
} from '../../../services/photogrammetry/brushRuntime';
import { brushTrainingManager } from '../../../services/photogrammetry/brushTrainingManager';
import { placeSplatOnTimeline } from '../../../services/photogrammetry/placeSplatOnTimeline';
import {
  isSupportedScanVideo,
  sampleScanVideoWithTimes,
} from '../../../services/photogrammetry/videoFrameSampler';
import { useMediaStore } from '../../../stores/mediaStore';
import { resolveMediaFileSourceFile } from '../../../stores/mediaStore/slices/fileManage/sourceResolution';
import { useTimelineStore } from '../../../stores/timeline';
import { CameraSolveWorkspace } from './CameraSolveWorkspace';
import './ThreeDScanPanel.css';

interface ScanSourceRow extends ScanImageAnalysis {
  previewUrl: string;
}

const MIN_RECOMMENDED_PHOTOS = 20;
const MOBILE_VIDEO_FRAME_COUNT = 24;
const DESKTOP_VIDEO_FRAME_COUNT = 60;
const SPLAT_ACCEPT = '.ply,.compressed.ply,.splat,.ksplat,.spz,.sog,.lcc,.zip';

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function phaseLabel(snapshot: BrushTrainingSnapshot): string {
  switch (snapshot.phase) {
    case 'loading-runtime': return 'Downloading GPU engine';
    case 'loading-dataset': return 'Loading registered views';
    case 'training': return 'Training splats';
    case 'paused': return 'Training paused';
    case 'completed': return 'Training complete';
    case 'cancelled': return 'Training cancelled';
    case 'error': return 'Training failed';
  }
}

function GaussianSplatWorkspace() {
  const importGaussianSplat = useMediaStore((state) => state.importGaussianSplat);
  const mediaFiles = useMediaStore((state) => state.files);
  const timelineClips = useTimelineStore((state) => state.clips);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore((state) => state.primarySelectedClipId);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const datasetInputRef = useRef<HTMLInputElement>(null);
  const splatInputRef = useRef<HTMLInputElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const datasetFilesRef = useRef<File[]>([]);
  const cameraResultOpeningRef = useRef(false);
  const [sources, setSources] = useState<ScanSourceRow[]>([]);
  const [gpu, setGpu] = useState<ScanGpuCapability>(getCheckingScanGpuCapability);
  const [dataset, setDataset] = useState<ColmapDatasetInspection | null>(null);
  const [preset, setPreset] = useState<BrushTrainingPreset>('preview');
  const trainingJob = useSyncExternalStore(
    brushTrainingManager.subscribe,
    brushTrainingManager.getSnapshot,
    brushTrainingManager.getSnapshot,
  );
  const cameraJob = useSyncExternalStore(
    cameraSolvingManager.subscribe,
    cameraSolvingManager.getSnapshot,
    cameraSolvingManager.getSnapshot,
  );
  const training = trainingJob.training;
  const cameraSolving = cameraJob.solving;
  const cameraSolvingActive = cameraJob.isStarting || Boolean(cameraSolving && ![
    'completed', 'cancelled', 'error',
  ].includes(cameraSolving.phase));
  const [isInspecting, setIsInspecting] = useState(false);
  const [videoProgress, setVideoProgress] = useState<{ current: number; total: number } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isDragActive, setIsDragActive] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [solveSource, setSolveSource] = useState<CameraSolveSourceContext | null>(null);
  const brushTrainingBlocked = gpu.status === 'limited';

  useEffect(() => {
    let active = true;
    void probeScanGpuCapability().then((capability) => {
      if (active) {
        setGpu(capability);
        if (capability.isMobile) setPreset('mobile');
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => () => {
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
  }, []);

  const appendPhotos = useCallback(async (
    candidateFiles: File[],
    sourceContext: CameraSolveSourceContext | null = null,
  ) => {
    const merged = mergeScanSourceFiles(sources.map((source) => source.file), candidateFiles);
    const rejected = [
      merged.duplicates ? `${merged.duplicates} duplicate${merged.duplicates === 1 ? '' : 's'}` : '',
      merged.unsupported ? `${merged.unsupported} unsupported file${merged.unsupported === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join(' and ');
    setNotice(rejected ? `Skipped ${rejected}.` : null);
    if (merged.files.length === 0) return;

    setDataset(null);
    setSolveSource(sources.length === 0 ? sourceContext : null);
    datasetFilesRef.current = [];
    cameraSolvingManager.reset();
    brushTrainingManager.reset();
    setIsInspecting(true);
    try {
      const analyses = await analyzeScanImages(merged.files);
      const rows = analyses.map((analysis) => {
        const previewUrl = URL.createObjectURL(analysis.file);
        previewUrlsRef.current.add(previewUrl);
        return { ...analysis, previewUrl };
      });
      setSources((current) => [...current, ...rows].toSorted((a, b) => a.file.name.localeCompare(b.file.name)));
    } finally {
      setIsInspecting(false);
    }
  }, [sources]);

  const removeSource = useCallback((key: string) => {
    setSolveSource(null);
    setSources((current) => current.filter((source) => {
      if (source.key !== key) return true;
      URL.revokeObjectURL(source.previewUrl);
      previewUrlsRef.current.delete(source.previewUrl);
      return false;
    }));
  }, []);

  const clearSources = useCallback(() => {
    cameraSolvingManager.reset();
    sources.forEach((source) => {
      URL.revokeObjectURL(source.previewUrl);
      previewUrlsRef.current.delete(source.previewUrl);
    });
    setSources([]);
    setSolveSource(null);
    setNotice(null);
  }, [sources]);

  const selectedTimelineVideo = useMemo(() => {
    const selectedClips = timelineClips.filter((candidate) => selectedClipIds.has(candidate.id));
    const primaryClip = selectedClips.find((candidate) => candidate.id === primarySelectedClipId);
    const orderedClips = primaryClip
      ? [primaryClip, ...selectedClips.filter((candidate) => candidate.id !== primaryClip.id)]
      : selectedClips;
    const clip = orderedClips.find((candidate) => candidate.source?.type === 'video')
      ?? orderedClips.find((candidate) => (
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

  const addVideo = useCallback(async (
    file: File | undefined,
    range?: { startTime: number; endTime: number },
    sourceLabel = file?.name,
    sourceContext: Omit<CameraSolveSourceContext, 'sampleTimes'> | null = null,
  ) => {
    if (!file) return;
    const frameCount = gpu.isMobile ? MOBILE_VIDEO_FRAME_COUNT : DESKTOP_VIDEO_FRAME_COUNT;
    setVideoProgress({ current: 0, total: frameCount });
    setNotice(null);
    try {
      const frames = await sampleScanVideoWithTimes(file, {
        frameCount,
        maxResolution: gpu.isMobile ? 960 : 1_600,
        startTime: range?.startTime,
        endTime: range?.endTime,
        onProgress: (current, total) => setVideoProgress({ current, total }),
      });
      const rangeDuration = range ? Math.max(0.001, range.endTime - range.startTime) : 1;
      await appendPhotos(frames.map((frame) => frame.file), sourceContext ? {
        ...sourceContext,
        sampleTimes: frames.map((frame) => (
          Math.max(0, Math.min(
            sourceContext.clipDuration ?? rangeDuration,
            ((frame.sourceTime - (range?.startTime ?? 0)) / rangeDuration) * (sourceContext.clipDuration ?? rangeDuration),
          ))
        )),
      } : null);
      setNotice(`Extracted ${frames.length} frames from ${sourceLabel ?? file.name} locally.`);
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setVideoProgress(null);
    }
  }, [appendPhotos, gpu.isMobile]);

  const addSelectedTimelineVideo = useCallback(async () => {
    if (!selectedTimelineVideo) {
      setNotice('Select a video clip in the timeline first.');
      return;
    }
    const { clip, mediaFile } = selectedTimelineVideo;
    const file = mediaFile
      ? await resolveMediaFileSourceFile(mediaFile)
      : clip.file;
    if (!file) {
      setNotice(`The source file for ${clip.name} is offline. Relink it in Media first.`);
      return;
    }
    await addVideo(file, {
      startTime: Math.max(0, clip.inPoint),
      endTime: Math.max(clip.inPoint, clip.outPoint),
    }, clip.name, {
      sourceClipId: clip.id,
      sourceClipName: clip.name,
      clipStartTime: clip.startTime,
      clipDuration: clip.duration,
    });
  }, [addVideo, selectedTimelineVideo]);

  const openDatasetFiles = useCallback(async (files: File[]) => {
    try {
      setNotice(null);
      const archive = files.length === 1 && isColmapDatasetArchive(files[0]) ? files[0] : null;
      const datasetFiles = archive
        ? await extractColmapDatasetArchive(archive)
        : files;
      const handle = createVirtualDirectoryHandle(datasetFiles);
      const inspection = await inspectColmapDataset(handle);
      brushTrainingManager.reset();
      datasetFilesRef.current = datasetFiles;
      setDataset(inspection);
      if (inspection.status === 'invalid') setNotice(inspection.message);
      return inspection;
    } catch (error) {
      setNotice(describeError(error));
      return null;
    }
  }, []);

  const solveCameraPoses = useCallback(async () => {
    const files = sources
      .filter((source) => source.quality !== 'error')
      .map((source) => source.file);
    if (files.length < 8) {
      setNotice('Camera solving needs at least 8 decodable overlapping photos.');
      return;
    }
    setDataset(null);
    datasetFilesRef.current = [];
    brushTrainingManager.reset();
    setNotice(null);
    const result = await cameraSolvingManager.start(
      files,
      'browser-video-scan',
      gpu.isMobile ? 512 : 720,
      solveSource,
    );
    if (!result) {
      const error = cameraSolvingManager.getSnapshot().error;
      if (error) setNotice(error);
      return;
    }
    cameraResultOpeningRef.current = true;
    try {
      const inspection = await openDatasetFiles(result.files);
      if (inspection?.status === 'valid') {
        setNotice(`Solved ${inspection.imageCount} camera views locally. Ready for GPU training.`);
      }
    } finally {
      cameraResultOpeningRef.current = false;
    }
  }, [gpu.isMobile, openDatasetFiles, solveSource, sources]);

  useEffect(() => {
    if (dataset || !cameraJob.hasResult || cameraResultOpeningRef.current) return;
    const files = cameraSolvingManager.getResultFiles();
    if (!files) return;
    cameraResultOpeningRef.current = true;
    void openDatasetFiles(files).finally(() => { cameraResultOpeningRef.current = false; });
  }, [cameraJob.hasResult, dataset, openDatasetFiles]);

  const mediaDatasetArchive = useMemo(
    () => mediaFiles.toReversed().find((file) => /\.zip$/i.test(file.name)),
    [mediaFiles],
  );

  const openMediaDatasetArchive = useCallback(async () => {
    if (!mediaDatasetArchive) return;
    const file = await resolveMediaFileSourceFile(mediaDatasetArchive);
    if (!file) {
      setNotice(`${mediaDatasetArchive.name} is offline. Relink it in Media first.`);
      return;
    }
    await openDatasetFiles([file]);
  }, [mediaDatasetArchive, openDatasetFiles]);

  const ingestDroppedFiles = useCallback(async (files: File[]) => {
    const datasetArchive = files.find(isColmapDatasetArchive);
    if (datasetArchive) await openDatasetFiles([datasetArchive]);
    const remainingFiles = files.filter((file) => file !== datasetArchive);
    const video = remainingFiles.find(isSupportedScanVideo);
    const photos = remainingFiles.filter((file) => !isSupportedScanVideo(file));
    if (video) await addVideo(video);
    if (photos.length > 0) await appendPhotos(photos);
  }, [addVideo, appendPhotos, openDatasetFiles]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragActive(false);
    void ingestDroppedFiles(Array.from(event.dataTransfer.files));
  }, [ingestDroppedFiles]);

  const launchTraining = useCallback(async (
    inspection: ColmapDatasetInspection,
    trainingPreset: BrushTrainingPreset,
  ) => {
    if (inspection.status !== 'valid' || gpu.status !== 'ready' || brushTrainingBlocked) return;
    brushTrainingManager.reset();
    setNotice(null);
    await brushTrainingManager.start(datasetFilesRef.current, trainingPreset, inspection.name);
    const error = brushTrainingManager.getSnapshot().error;
    if (error) setNotice(error);
  }, [brushTrainingBlocked, gpu.status]);

  const startTraining = useCallback(async () => {
    if (dataset) await launchTraining(dataset, preset);
  }, [dataset, launchTraining, preset]);

  const resetTraining = useCallback(() => {
    brushTrainingManager.reset();
  }, []);

  const addTrainingToMedia = useCallback(async () => {
    if (!trainingJob.datasetName) return;
    setIsExporting(true);
    setNotice(null);
    try {
      const bytes = await brushTrainingManager.exportPly();
      const safeName = trainingJob.datasetName.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'browser-scan';
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const file = new File([buffer], `${safeName}-trained.ply`, { type: 'application/octet-stream' });
      const imported = await importGaussianSplat(file);
      await placeSplatOnTimeline(file, imported);
      setNotice(`${file.name} is in Media and on the timeline.`);
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setIsExporting(false);
    }
  }, [importGaussianSplat, trainingJob.datasetName]);

  const addSparsePreviewToMedia = useCallback(async () => {
    if (!dataset || dataset.status !== 'valid') return;
    setIsExporting(true);
    setNotice(null);
    try {
      const result = await createColmapSparsePreviewSplat(dataset.handle, dataset.name);
      const imported = await importGaussianSplat(result.file);
      await placeSplatOnTimeline(result.file, imported);
      setNotice(`${result.file.name} is in Media and on the timeline with ${result.pointCount.toLocaleString()} sparse splats.`);
    } catch (error) {
      setNotice(describeError(error));
    } finally {
      setIsExporting(false);
    }
  }, [dataset, importGaussianSplat]);

  const importExistingSplat = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      await importGaussianSplat(file);
      setNotice(`${file.name} was added to Media.`);
    } catch (error) {
      setNotice(describeError(error));
    }
  }, [importGaussianSplat]);

  const goodPhotoCount = useMemo(
    () => sources.filter((source) => source.quality === 'good').length,
    [sources],
  );
  const photoReady = goodPhotoCount >= MIN_RECOMMENDED_PHOTOS;
  const datasetReady = dataset?.status === 'valid';
  const canTrain = datasetReady && gpu.status === 'ready' && !brushTrainingBlocked
    && !training && !trainingJob.isStarting && !cameraSolvingActive;
  const progress = training
    ? Math.min(100, (training.iteration / Math.max(1, training.totalIterations)) * 100)
    : 0;

  return (
    <div
      className={`three-d-scan-panel ${isDragActive ? 'drop-target' : ''}`}
      onDragEnter={(event) => { event.preventDefault(); setIsDragActive(true); }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragActive(false);
      }}
      onDrop={handleDrop}
    >
      <input
        ref={photoInputRef}
        className="scan-hidden-input"
        type="file"
        accept="image/*,.heic,.heif"
        multiple
        onChange={(event) => {
          void appendPhotos(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={videoInputRef}
        className="scan-hidden-input"
        type="file"
        accept="video/*,.m4v,.mkv,.mov,.mp4,.webm"
        onChange={(event) => {
          void addVideo(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={datasetInputRef}
        className="scan-hidden-input"
        type="file"
        accept=".zip,application/zip"
        data-testid="scan-dataset-input"
        onChange={(event) => {
          void openDatasetFiles(Array.from(event.currentTarget.files ?? []));
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={splatInputRef}
        className="scan-hidden-input"
        type="file"
        accept={SPLAT_ACCEPT}
        onChange={(event) => {
          void importExistingSplat(event.currentTarget.files?.[0]);
          event.currentTarget.value = '';
        }}
      />

      <div className="three-d-scan-header">
        <span className="three-d-scan-count">
          {sources.length > 0 ? `${sources.length} photos` : dataset?.name ?? trainingJob.datasetName ?? 'New browser scan'}
        </span>
        <div className="three-d-scan-actions">
          <button className="btn btn-sm" onClick={() => splatInputRef.current?.click()}>Import splat</button>
          <button
            className="btn btn-sm"
            title="Open a zipped COLMAP dataset"
            onClick={() => datasetInputRef.current?.click()}
          >
            Dataset
          </button>
          {mediaDatasetArchive && (
            <button
              className="btn btn-sm"
              title={`Open ${mediaDatasetArchive.name} from Media`}
              onClick={() => void openMediaDatasetArchive()}
            >
              Media ZIP
            </button>
          )}
          <button
            className="btn btn-sm"
            disabled={!selectedTimelineVideo}
            onClick={() => void addSelectedTimelineVideo()}
            title={selectedTimelineVideo ? `Extract frames from ${selectedTimelineVideo.clip.name}` : 'Select a timeline video clip'}
          >
            Timeline
          </button>
          <button className="btn btn-sm" onClick={() => videoInputRef.current?.click()}>+ Video</button>
          <button className="btn btn-sm scan-add-button" onClick={() => photoInputRef.current?.click()}>+ Add photos</button>
        </div>
      </div>

      <div className="three-d-scan-content">
        <aside className="scan-workflow" aria-label="3D scan workflow">
          <div className={`scan-workflow-step ${photoReady ? 'complete' : sources.length ? 'active' : ''}`}>
            <span>1</span><div><strong>Photos</strong><small>{sources.length ? `${goodPhotoCount} usable` : 'Add a capture set'}</small></div>
          </div>
          <div className={`scan-workflow-step ${datasetReady || training ? 'complete' : cameraSolvingActive ? 'active' : dataset ? 'warning' : ''}`}>
            <span>2</span><div><strong>Camera poses</strong><small>{datasetReady ? 'COLMAP ready' : cameraSolvingActive ? 'Solving locally' : 'Solve in browser'}</small></div>
          </div>
          <div className={`scan-workflow-step ${training ? 'active' : ''}`}>
            <span>3</span><div><strong>GPU train</strong><small>{training ? phaseLabel(training) : `${formatScanBytes(BRUSH_RUNTIME_COMPRESSED_ESTIMATE_BYTES)} on first use`}</small></div>
          </div>
        </aside>

        <main className="scan-stage">
          {sources.length === 0 && !dataset && !training ? (
            <div className="scan-empty">
              <IconPhoto size={40} stroke={1.25} />
              <strong>Drop object photos or a video here</strong>
              <span>Use a slow orbit with the subject still and fully visible</span>
              <div className="scan-empty-actions">
                <button className="btn btn-sm" disabled={!selectedTimelineVideo} onClick={() => void addSelectedTimelineVideo()}>
                  Use timeline clip
                </button>
                {mediaDatasetArchive && (
                  <button className="btn btn-sm" onClick={() => void openMediaDatasetArchive()}>Use Media ZIP</button>
                )}
                <button className="btn btn-sm" onClick={() => photoInputRef.current?.click()}>Add photos</button>
              </div>
            </div>
          ) : (
            <>
              {sources.length > 0 && (
                <section className="scan-section">
                  <div className="scan-section-heading">
                    <div><strong>Source photos</strong><span>{goodPhotoCount} ready · {sources.length - goodPhotoCount} need attention</span></div>
                    <button className="scan-icon-button" onClick={clearSources} title="Clear photos"><IconTrash size={15} /></button>
                  </div>
                  <div className="scan-photo-list">
                    {sources.map((source) => (
                      <div className="scan-photo-row" key={source.key}>
                        <img src={source.previewUrl} alt="" loading="lazy" decoding="async" />
                        <div className="scan-photo-name"><strong>{source.file.name}</strong><span>{source.width} × {source.height} · {source.megapixels.toFixed(1)} MP</span></div>
                        <span className={`scan-quality ${source.quality}`} title={source.note}>
                          {source.quality === 'good' ? <IconCheck size={14} /> : <IconAlertTriangle size={14} />}
                        </span>
                        <button className="scan-icon-button" onClick={() => removeSource(source.key)} title="Remove photo"><IconX size={14} /></button>
                      </div>
                    ))}
                  </div>
                  <p className="scan-inline-note">
                    Camera poses are solved locally from overlapping features. Nothing is uploaded.
                  </p>
                  {!dataset && (
                    <button
                      className="btn btn-export scan-train-button"
                      disabled={!photoReady || cameraSolvingActive}
                      onClick={() => void solveCameraPoses()}
                    >
                      {cameraSolvingActive ? 'Solving camera poses…' : 'Solve camera poses locally'}
                    </button>
                  )}
                </section>
              )}

              {!dataset && (cameraJob.isStarting || cameraSolving || cameraJob.error) && (
                <section className={`scan-section scan-training ${cameraSolving?.phase ?? 'loading-runtime'}`}>
                  <div className="scan-section-heading">
                    <div>
                      <strong>{cameraJob.error ? 'Camera solving failed' : 'Solving camera poses'}</strong>
                      <span>{cameraJob.error ?? cameraSolving?.message ?? 'Loading browser vision engine'}</span>
                    </div>
                    <IconBox size={18} />
                  </div>
                  <div className="scan-progress">
                    <span style={{ width: `${cameraSolving ? Math.min(100, cameraSolving.current / Math.max(1, cameraSolving.total) * 100) : 0}%` }} />
                  </div>
                  <div className="scan-metrics">
                    <span><strong>{cameraSolving?.registeredImages ?? 0}</strong> cameras</span>
                    <span><strong>{(cameraSolving?.pointCount ?? 0).toLocaleString()}</strong> points</span>
                    <span><strong>{cameraSolving?.current ?? 0}/{cameraSolving?.total ?? sources.length}</strong> frames</span>
                  </div>
                  <div className="scan-training-actions">
                    {cameraSolvingActive && <button className="btn btn-sm" onClick={() => cameraSolvingManager.cancel()}>Cancel</button>}
                    {cameraJob.error && <button className="btn btn-sm" onClick={() => cameraSolvingManager.reset()}>Reset</button>}
                  </div>
                </section>
              )}

              {dataset && (
                <section className={`scan-section scan-dataset ${dataset.status}`}>
                  <div className="scan-section-heading">
                    <div><strong>{dataset.name}</strong><span>{dataset.message}</span></div>
                    {dataset.status === 'valid' ? <IconCheck size={17} /> : <IconAlertTriangle size={17} />}
                  </div>
                </section>
              )}

              {!training && datasetReady && (
                <section className="scan-section scan-train-setup">
                  <div className="scan-section-heading"><div><strong>Gaussian splat training</strong><span>Runs locally on the selected GPU</span></div></div>
                  <label className="scan-preset-row">
                    <span>Preset</span>
                    <select value={preset} onChange={(event) => setPreset(event.target.value as BrushTrainingPreset)}>
                      <option value="preview">Preview · 720p / 40K splats</option>
                      <option value="mobile">Mobile · 720p / 60K splats</option>
                      <option value="balanced">Balanced · 960p / 100K splats</option>
                      <option value="quality">Quality · 1080p / 120K splats</option>
                    </select>
                  </label>
                  <p className="scan-inline-note">
                    The rough preview uses sparse COLMAP points to check framing. It is not a trained Gaussian splat.
                  </p>
                  <button className="btn btn-export scan-train-button" disabled={isExporting} onClick={() => void addSparsePreviewToMedia()}>
                    {isExporting ? 'Creating rough preview…' : 'Create rough preview on timeline'}
                  </button>
                  <button className="btn btn-export scan-train-button" disabled={!canTrain} onClick={() => void startTraining()}>
                    {brushTrainingBlocked
                      ? 'Brush training unavailable on this GPU'
                        : trainingJob.isStarting
                        ? 'Loading engine…'
                        : gpu.status === 'ready'
                          ? 'Start GPU training'
                          : 'GPU training unavailable'}
                  </button>
                  {brushTrainingBlocked && (
                    <p className="scan-inline-note warning">
                      Brush training needs WebGPU subgroup support on this device. Instant sparse preview remains available.
                    </p>
                  )}
                </section>
              )}

              {training && (
                <section className={`scan-section scan-training ${training.phase}`}>
                  <div className="scan-section-heading"><div><strong>{phaseLabel(training)}</strong><span>{training.iteration.toLocaleString()} / {training.totalIterations.toLocaleString()} steps</span></div><IconBox size={18} /></div>
                  <div className="scan-progress"><span style={{ width: `${progress}%` }} /></div>
                  <div className="scan-metrics">
                    <span><strong>{training.splatCount.toLocaleString()}</strong> splats</span>
                    <span><strong>{training.trainViews}</strong> views</span>
                    <span><strong>{training.psnr?.toFixed(2) ?? '—'}</strong> PSNR</span>
                  </div>
                  {training.warning && <p className="scan-inline-note warning">{training.warning}</p>}
                  <div className="scan-training-actions">
                    {training.phase === 'training' && <button className="btn btn-sm" onClick={() => brushTrainingManager.pause()}><IconPlayerPause size={13} /> Pause</button>}
                    {training.phase === 'paused' && <button className="btn btn-sm" onClick={() => brushTrainingManager.resume()}><IconPlayerPlay size={13} /> Resume</button>}
                    {!['completed', 'cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={() => brushTrainingManager.cancel()}>Cancel</button>}
                    {['cancelled', 'error'].includes(training.phase) && <button className="btn btn-sm" onClick={resetTraining}>Reset</button>}
                    {training.phase === 'completed' && <button className="btn btn-export" disabled={isExporting} onClick={() => void addTrainingToMedia()}>{isExporting ? 'Creating PLY…' : 'Add splat to Media'}</button>}
                  </div>
                </section>
              )}
            </>
          )}
        </main>
      </div>

      <footer className={`scan-status-bar ${brushTrainingBlocked ? 'limited' : gpu.status}`}>
        <span className="scan-status-dot" />
        <span>{gpu.adapterName}</span>
        <span className="scan-status-message">
          {brushTrainingBlocked ? 'Rough preview available; this GPU lacks subgroup support.' : gpu.message}
        </span>
      </footer>

      {notice && <div className="scan-notice" role="status">{notice}</div>}
      {(isInspecting || videoProgress) && (
        <div className="scan-busy">
          {videoProgress
            ? `Extracting video frames… ${videoProgress.current}/${videoProgress.total}`
            : 'Inspecting photos…'}
        </div>
      )}
      {isDragActive && <div className="scan-drop-overlay"><IconFolderOpen size={28} /><span>Drop photos to add them</span></div>}
    </div>
  );
}

export function ThreeDScanPanel() {
  const [workspace, setWorkspace] = useState<'splat' | 'camera'>('splat');
  return (
    <div className="three-d-tools-panel">
      <div className="scan-mode-switch" role="tablist" aria-label="3D reconstruction mode">
        <button
          role="tab"
          aria-selected={workspace === 'splat'}
          className={workspace === 'splat' ? 'active' : ''}
          onClick={() => setWorkspace('splat')}
        >
          Gaussian Splat
        </button>
        <button
          role="tab"
          aria-selected={workspace === 'camera'}
          className={workspace === 'camera' ? 'active' : ''}
          onClick={() => setWorkspace('camera')}
        >
          Camera Solve
        </button>
      </div>
      <div className="scan-mode-body" hidden={workspace !== 'splat'}>
        <GaussianSplatWorkspace />
      </div>
      <div className="scan-mode-body" hidden={workspace !== 'camera'}>
        <CameraSolveWorkspace
          active={workspace === 'camera'}
          onUseForSplat={() => setWorkspace('splat')}
        />
      </div>
    </div>
  );
}
