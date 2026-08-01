// Export Panel - embedded panel for frame-by-frame video export

import { useCallback, useMemo, useRef, useState, type DragEvent as ReactDragEvent } from 'react';
import './ExportPanel.css';
import { Logger } from '../../services/logger';
import { projectFileService } from '../../services/projectFileService';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { resolveExportRange } from './exportRange';
import { useExportState } from './useExportState';
import { ExportAdvancedSummarySections } from './ExportAdvancedSummarySections';
import { ExportProgressView } from './ExportProgressView';
import {
  buildExportSettingsState,
  formatExportTime,
} from './exportSettingsState';
import type { ExportSummaryTarget } from './exportSummaryState';
import { useExportRunController } from './useExportRunController';
import {
  useExportStore,
  type BatchExportData,
  type BatchExportSource,
} from '../../stores/exportStore';
import { ExportAdvancedSections } from './panel/ExportAdvancedSections';
import { ExportBasicsSection } from './panel/ExportBasicsSection';
import {
  ExportPresetCommandSection,
  ExportSummaryBadgesSection,
  ExportWorkflowSection,
} from './panel/ExportTopSections';
import type {
  ExportBasicsActions,
  ExportBasicsAudioState,
  ExportBasicsDisplayState,
  ExportBasicsGifState,
  ExportBasicsImageState,
  ExportBasicsModeState,
  ExportBasicsOptionState,
  ExportBasicsTimeState,
  ExportBasicsVideoState,
} from './panel/exportBasicsTypes';
import { resolveStoryboardExportGuard } from '../../services/storyboard/animatic/exportPolicy';
import type { StoryboardAnimaticRenderMode } from '../../services/storyboard/animatic/types';
import { StoryboardExportModeControl } from './storyboard/StoryboardExportModeControl';
import { BatchExportQueue } from './batch/BatchExportQueue';
import { useBatchExportController } from './batch/useBatchExportController';
import {
  clearExportMediaDragIds,
  EXPORT_MEDIA_IDS_MIME_TYPE,
  readExportMediaIdsFromDataTransfer,
} from '../timeline/utils/externalDragSession';

const log = Logger.create('ExportPanel');
const EMPTY_BATCH_EXPORT: BatchExportData = {
  enabled: false,
  useSharedSettings: false,
  selectedJobId: null,
  jobs: [],
};

export function ExportPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const summaryHighlightTimeoutsRef = useRef<Map<HTMLElement, number>>(new Map());
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const [isBatchDragOver, setIsBatchDragOver] = useState(false);
  const [storyboardExportMode, setStoryboardExportMode] = useState<
    Exclude<StoryboardAnimaticRenderMode, 'preview'>
  >('normal-export');
  const { duration, inPoint, outPoint, playheadPosition, clips, tracks, startExport, setExportProgress, endExport } = useTimelineStore(useShallow(s => ({
    duration: s.duration,
    inPoint: s.inPoint,
    outPoint: s.outPoint,
    playheadPosition: s.playheadPosition,
    clips: s.clips,
    tracks: s.tracks,
    startExport: s.startExport,
    setExportProgress: s.setExportProgress,
    endExport: s.endExport,
  })));
  const { composition, getActiveComposition, mediaFiles } = useMediaStore(useShallow(s => ({
    composition: s.compositions.find((candidate) => candidate.id === s.activeCompositionId),
    getActiveComposition: s.getActiveComposition,
    mediaFiles: s.files,
  })));
  const {
    batch,
    presets,
    selectedPresetId,
    setSelectedPresetId,
    savePreset,
    updatePreset,
    loadPreset,
    setSettings,
    enqueueBatchJobs,
    removeBatchJob,
    clearBatchJobs,
    setBatchEnabled,
    setBatchUseSharedSettings,
    setSelectedBatchJobId,
    updateBatchJobSettings,
    replaceBatchJobSettings,
  } = useExportStore(useShallow((state) => ({
    batch: state.batch ?? EMPTY_BATCH_EXPORT,
    presets: state.presets,
    selectedPresetId: state.selectedPresetId,
    setSelectedPresetId: state.setSelectedPresetId,
    savePreset: state.savePreset,
    updatePreset: state.updatePreset,
    loadPreset: state.loadPreset,
    setSettings: state.setSettings,
    enqueueBatchJobs: state.enqueueBatchJobs,
    removeBatchJob: state.removeBatchJob,
    clearBatchJobs: state.clearBatchJobs,
    setBatchEnabled: state.setBatchEnabled,
    setBatchUseSharedSettings: state.setBatchUseSharedSettings,
    setSelectedBatchJobId: state.setSelectedBatchJobId,
    updateBatchJobSettings: state.updateBatchJobSettings,
    replaceBatchJobSettings: state.replaceBatchJobSettings,
  })));

  const selectedBatchJob = useMemo(() => (
    batch.jobs.find((job) => job.id === batch.selectedJobId) ?? batch.jobs[0]
  ), [batch.jobs, batch.selectedJobId]);
  const batchActive = batch.enabled && batch.jobs.length > 0 && !!selectedBatchJob;
  const selectedBatchJobId = selectedBatchJob?.id;
  const setEffectiveExportSettings = useCallback((patch: Parameters<typeof setSettings>[0]) => {
    if (batchActive && selectedBatchJobId) {
      updateBatchJobSettings(selectedBatchJobId, patch);
      return;
    }
    setSettings(patch);
  }, [batchActive, selectedBatchJobId, setSettings, updateBatchJobSettings]);

  // All export state, effects, and simple handlers extracted to hook
  const exportState = useExportState(composition, {
    settings: batchActive ? selectedBatchJob?.settings : undefined,
    setSettings: setEffectiveExportSettings,
  });
  const {
    encoder, setEncoder,
    width, height,
    customWidth, setCustomWidth, customHeight, setCustomHeight,
    useCustomResolution, setUseCustomResolution,
    fps, setFps, customFps, setCustomFps, useCustomFps, setUseCustomFps,
    useInOut, setUseInOut, filename, setFilename,
    bitrate, setBitrate, containerFormat, setContainerFormat,
    videoCodec, setVideoCodec, codecSupport, rateControl, setRateControl,
    ffmpegCodec, ffmpegContainer,
    proresProfile, setProresProfile, dnxhrProfile, setDnxhrProfile,
    ffmpegQuality, setFfmpegQuality, ffmpegBitrate, ffmpegRateControl,
    gifColors, setGifColors,
    gifDither, setGifDither,
    gifLoop, setGifLoop, gifLoopCount, setGifLoopCount,
    gifPaletteMode, setGifPaletteMode,
    gifOptimize, setGifOptimize,
    gifTransparency, setGifTransparency,
    gifAlphaThreshold, setGifAlphaThreshold,
    gifBayerScale, setGifBayerScale,
    isFFmpegLoading, isFFmpegReady, ffmpegLoadError,
    stackedAlpha, setStackedAlpha,
    includeAudio, setIncludeAudio, audioOnlyFormat, setAudioOnlyFormat, audioSampleRate, setAudioSampleRate,
    audioBitrate, setAudioBitrate, normalizeAudio, setNormalizeAudio,
    videoEnabled, setVideoEnabled,
    visualMode, setVisualMode,
    imageFormat, setImageFormat,
    imageExportMode, setImageExportMode,
    imageQuality, setImageQuality,
    specialContainer, setSpecialContainer,
    isExporting, progress,
    ffmpegProgress, exportPhase,
    error,
    isSupported, isAudioSupported, audioCodec,
    isFFmpegSupported, isFFmpegMultiThreaded,
    handleResolutionChange, loadFFmpeg,
    handleFFmpegContainerChange, handleFFmpegCodecChange,
  } = exportState;
  const {
    runtimeByJob,
    isRunning: isBatchRunning,
    overallProgress: batchOverallProgress,
    failedCount: batchFailedCount,
    runBatch,
    cancelBatch,
  } = useBatchExportController({ jobs: batch.jobs, mediaFiles });

  const selectedBatchMedia = batchActive
    ? mediaFiles.find((mediaFile) => mediaFile.id === selectedBatchJob?.mediaFileId)
    : undefined;
  const selectedBatchSourceType = selectedBatchJob?.mediaType;
  // Batch source jobs always cover the full source file; timeline In/Out only
  // belongs to the composition export path.
  const compositionRange = resolveExportRange({ duration, inPoint, outPoint }, useInOut);
  const startTime = batchActive ? 0 : compositionRange.startTime;
  const endTime = batchActive
    ? Math.max(
        0.001,
        selectedBatchMedia?.type === 'image'
          ? 1 / Math.max(1, fps)
          : selectedBatchMedia?.duration ?? 1,
      )
    : compositionRange.endTime;
  const storyboardClips = clips ?? [];
  const storyboardTracks = tracks ?? [];
  const storyboardExportGuard = resolveStoryboardExportGuard({
    mode: storyboardExportMode,
    clips: storyboardClips,
    tracks: storyboardTracks,
    startTime,
    endTime,
  });
  const hasStoryboardScenesInRange = storyboardClips.some(clip =>
    clip.source?.type === 'storyboard' &&
    clip.startTime < endTime &&
    clip.startTime + clip.duration > startTime
  );

  const formatTime = formatExportTime;
  const {
    actualWidth,
    actualHeight,
    actualFps,
    imageSequenceFrameCount,
    gifSizeRangeLabel,
    webCodecsAvailable,
    ffmpegAvailable,
    ffmpegCodecInfo,
    showFFmpegQualityControl,
    isWebCodecsEncoder,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    imageSequenceFolderSupported,
    imageSequenceOutputLabel,
    isGifMode,
    isVideoMode,
    isAudioOnlyMode,
    currentContainerId,
    currentCodecLabel,
    methodMeta,
    selectedImageFormat,
    browserAudioExtension,
    browserAudioCodecLabel,
    browserAudioUnavailable,
    currentAudioCodecLabel,
    outputHeight,
    frameCount,
    displayOutputName,
    displayContainerLabel,
    estimatedSizeLabel,
    sizeStatLabel,
    webCodecsRateNote,
    exportDisabled,
    primaryExportLabel,
    usesBrowserProgress,
    summaryBadges,
    showRangeInVideo,
    showRangeInAudio,
    quickResolutionPresets,
    quickFrameRatePresets,
    videoContainerFormats,
    webQualityPresets,
    audioSampleRatePresets,
    audioBitratePresets,
    selectedPresetName,
  } = buildExportSettingsState({
    composition,
    presets,
    selectedPresetId,
    durationStartTime: startTime,
    durationEndTime: endTime,
    playheadPosition,
    encoder,
    width,
    height,
    customWidth,
    customHeight,
    useCustomResolution,
    fps,
    customFps,
    useCustomFps,
    filename,
    bitrate,
    containerFormat,
    videoCodec,
    rateControl,
    ffmpegCodec,
    ffmpegContainer,
    ffmpegQuality,
    ffmpegBitrate,
    ffmpegRateControl,
    gifColors,
    gifDither,
    gifLoop,
    gifLoopCount,
    gifPaletteMode,
    gifOptimize,
    gifTransparency,
    gifAlphaThreshold,
    gifBayerScale,
    stackedAlpha,
    includeAudio,
    audioOnlyFormat,
    audioSampleRate,
    audioBitrate,
    normalizeAudio,
    audioCodec,
    isAudioSupported,
    isSupported,
    isFFmpegSupported,
    isFFmpegLoading,
    isFFmpegMultiThreaded,
    videoEnabled,
    visualMode,
    imageFormat,
    imageExportMode,
    imageQuality,
    specialContainer,
    isExporting: isExporting || (batchActive && isBatchRunning),
  });
  const { handleCancel, handlePrimaryExport } = useExportRunController({
    exportState,
    playheadPosition,
    startExport,
    setExportProgress,
    endExport,
    getActiveComposition,
    selectedImageFormat,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    isGifMode,
    isWebCodecsEncoder,
    storyboardExportMode: isVideoMode ? storyboardExportMode : 'normal-export',
  });

  const handleQuickResolutionPreset = useCallback((value: string) => {
    setUseCustomResolution(false);
    handleResolutionChange(value);
  }, [handleResolutionChange, setUseCustomResolution]);

  const handleQuickFpsPreset = useCallback((value: number) => {
    setUseCustomFps(false);
    setFps(value);
  }, [setFps, setUseCustomFps]);

  const sameAsComposition = !batchActive && !!composition &&
    actualWidth === composition.width &&
    actualHeight === composition.height &&
    actualFps === composition.frameRate;

  const syncCompositionSettings = useCallback(() => {
    if (!composition || sameAsComposition) return;
    setSettings({
      customWidth: composition.width,
      customHeight: composition.height,
      useCustomResolution: true,
      customFps: composition.frameRate,
      useCustomFps: true,
    });
  }, [composition, sameAsComposition, setSettings]);

  const handleQuickBitratePreset = useCallback((value: number) => {
    setRateControl('vbr');
    setBitrate(value);
  }, [setBitrate, setRateControl]);

  const handleBatchDragOver = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const hasBatchType = Array.from(event.dataTransfer.types).includes(EXPORT_MEDIA_IDS_MIME_TYPE);
    const hasBatchIds = hasBatchType || readExportMediaIdsFromDataTransfer(event.dataTransfer).length > 0;
    if (!hasBatchIds || isBatchRunning) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'copy';
    setIsBatchDragOver(true);
  }, [isBatchRunning]);

  const handleBatchDragLeave = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const relatedTarget = event.relatedTarget;
    if (relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)) return;
    setIsBatchDragOver(false);
  }, []);

  const handleBatchDrop = useCallback((event: ReactDragEvent<HTMLDivElement>) => {
    const mediaIds = readExportMediaIdsFromDataTransfer(event.dataTransfer);
    setIsBatchDragOver(false);
    clearExportMediaDragIds();
    if (mediaIds.length === 0 || isBatchRunning) return;

    event.preventDefault();
    event.stopPropagation();
    const mediaById = new Map(mediaFiles.map((mediaFile) => [mediaFile.id, mediaFile]));
    const sources = mediaIds.flatMap<BatchExportSource>((mediaFileId) => {
      const mediaFile = mediaById.get(mediaFileId);
      if (!mediaFile || (mediaFile.type !== 'video' && mediaFile.type !== 'audio' && mediaFile.type !== 'image')) {
        return [];
      }
      return [{
        mediaFileId: mediaFile.id,
        sourceName: mediaFile.name,
        mediaType: mediaFile.type,
      }];
    });
    if (sources.length > 0) {
      enqueueBatchJobs(sources);
    }
  }, [enqueueBatchJobs, isBatchRunning, mediaFiles]);

  const saveCurrentSetup = useCallback(() => {
    try {
      const suggestedName = selectedPresetName || filename || 'Export Preset';
      const nextName = window.prompt('Preset name', suggestedName);
      if (nextName === null) {
        return;
      }

      const result = savePreset(nextName, batchActive ? selectedBatchJob?.settings : undefined);
      if (!result) {
        setSetupStatus('Preset name required');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(result.overwritten ? `Preset updated${suffix}` : `Preset saved${suffix}`);
    } catch (error) {
      log.error('Failed to save export setup', error);
      setSetupStatus('Preset save failed');
    }
  }, [batchActive, filename, savePreset, selectedBatchJob, selectedPresetName]);

  const updateCurrentSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const updatedPreset = updatePreset(
        selectedPresetId,
        batchActive ? selectedBatchJob?.settings : undefined,
      );
      if (!updatedPreset) {
        setSetupStatus('Preset not found');
        return;
      }

      const suffix = projectFileService.isProjectOpen() ? '' : ' (session only)';
      setSetupStatus(`Preset updated${suffix}`);
    } catch (error) {
      log.error('Failed to update export setup', error);
      setSetupStatus('Preset update failed');
    }
  }, [batchActive, presets.length, selectedBatchJob, selectedPresetId, updatePreset]);

  const loadSavedSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const preset = presets.find((candidate) => candidate.id === selectedPresetId);
      let loaded = false;
      if (batchActive && selectedBatchJob) {
        if (preset) {
          replaceBatchJobSettings(selectedBatchJob.id, preset.settings);
          loaded = true;
        }
      } else {
        loaded = loadPreset(selectedPresetId);
      }
      setSetupStatus(loaded ? 'Preset loaded' : 'Preset not found');
    } catch (error) {
      log.error('Failed to load export setup', error);
      setSetupStatus('Preset load failed');
    }
  }, [batchActive, loadPreset, presets, replaceBatchJobSettings, selectedBatchJob, selectedPresetId]);

  const scrollToSummaryTarget = useCallback((target: ExportSummaryTarget) => {
    const scrollContainer = panelRef.current?.querySelector<HTMLElement>('.export-form');
    const node = panelRef.current?.querySelector<HTMLElement>(`[data-export-target="${target}"]`);
    if (!scrollContainer || !node) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const stickySummaryHeight = panelRef.current?.querySelector<HTMLElement>('.export-top-stack')?.offsetHeight
      ?? panelRef.current?.querySelector<HTMLElement>('.export-summary-sticky')?.offsetHeight
      ?? 0;
    scrollContainer.scrollTo({
      behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      top: Math.max(0, scrollContainer.scrollTop + nodeRect.top - containerRect.top - stickySummaryHeight - 12),
    });

    const existingTimeout = summaryHighlightTimeoutsRef.current.get(node);
    if (existingTimeout) {
      window.clearTimeout(existingTimeout);
    }

    node.classList.remove('export-scroll-highlight');
    void node.offsetHeight;
    node.classList.add('export-scroll-highlight');

    const timeout = window.setTimeout(() => {
      node.classList.remove('export-scroll-highlight');
      summaryHighlightTimeoutsRef.current.delete(node);
    }, 1200);

    summaryHighlightTimeoutsRef.current.set(node, timeout);
  }, []);

  const basicsMode: ExportBasicsModeState = {
    encoder,
    isWebCodecsEncoder,
    webCodecsAvailable,
    ffmpegAvailable,
    isFFmpegLoading,
    isFFmpegReady,
    ffmpegLoadError,
    isXmlMode,
    isImageMode,
    isImageSequenceMode,
    imageSequenceFolderSupported,
    imageSequenceOutputLabel,
    isGifMode,
    isVideoMode,
    isAudioOnlyMode,
    videoEnabled,
    includeAudio,
    isAudioSupported,
    browserAudioUnavailable,
    showRangeInVideo: batchActive ? false : showRangeInVideo,
    showRangeInAudio: batchActive ? false : showRangeInAudio,
    showFFmpegQualityControl,
  };

  const basicsDisplay: ExportBasicsDisplayState = {
    displayOutputName,
    displayContainerLabel,
    currentContainerId,
    currentCodecLabel,
    currentAudioCodecLabel,
    browserAudioExtension,
    browserAudioCodecLabel,
    methodMeta,
    ffmpegCodecInfo: ffmpegCodecInfo ?? null,
    estimatedSizeLabel,
    sizeStatLabel,
    webCodecsRateNote,
    gifSizeRangeLabel,
  };

  const basicsVideo: ExportBasicsVideoState = {
    width,
    height,
    customWidth,
    customHeight,
    useCustomResolution,
    actualWidth,
    actualHeight,
    outputHeight,
    fps,
    customFps,
    useCustomFps,
    actualFps,
    frameCount,
    bitrate,
    rateControl,
    containerFormat,
    videoCodec,
    codecSupport,
    ffmpegCodec,
    ffmpegContainer,
    proresProfile,
    dnxhrProfile,
    ffmpegQuality,
    stackedAlpha,
  };

  const basicsGif: ExportBasicsGifState = {
    gifColors,
    gifDither,
    gifLoop,
    gifLoopCount,
    gifPaletteMode,
    gifOptimize,
    gifTransparency,
    gifAlphaThreshold,
    gifBayerScale,
  };

  const basicsImage: ExportBasicsImageState = {
    imageFormat,
    imageExportMode,
    imageQuality,
    selectedImageFormat,
    imageSequenceFrameCount,
  };

  const basicsAudio: ExportBasicsAudioState = {
    includeAudio,
    audioOnlyFormat,
    audioSampleRate,
    audioBitrate,
    normalizeAudio,
  };

  const basicsOptions: ExportBasicsOptionState = {
    videoContainerFormats,
    quickResolutionPresets,
    quickFrameRatePresets,
    webQualityPresets,
    audioSampleRatePresets,
    audioBitratePresets,
  };

  const basicsTime: ExportBasicsTimeState = {
    startTime,
    endTime,
    playheadPosition,
    formatTime,
  };

  const basicsActions: ExportBasicsActions = {
    setEncoder,
    setFilename,
    setContainerFormat,
    handleFFmpegContainerChange,
    setSpecialContainer,
    setVideoEnabled,
    setVisualMode,
    setIncludeAudio,
    setImageFormat,
    setImageExportMode,
    setImageQuality,
    handleQuickResolutionPreset,
    handleResolutionChange,
    setUseCustomResolution,
    setCustomWidth,
    setCustomHeight,
    handleQuickFpsPreset,
    setUseCustomFps,
    setFps,
    setCustomFps,
    setRateControl,
    setBitrate,
    handleQuickBitratePreset,
    setFfmpegQuality,
    handleFFmpegCodecChange,
    setVideoCodec,
    setProresProfile,
    setDnxhrProfile,
    setStackedAlpha,
    setUseInOut,
    setAudioOnlyFormat,
    setAudioSampleRate,
    setAudioBitrate,
    setNormalizeAudio,
    setGifColors,
    setGifDither,
    setGifLoop,
    setGifLoopCount,
    setGifPaletteMode,
    setGifOptimize,
    setGifTransparency,
    setGifAlphaThreshold,
    setGifBayerScale,
    loadFFmpeg,
  };

  const handlePanelPrimaryExport = useCallback(() => {
    if (batchActive) {
      void runBatch();
      return;
    }
    handlePrimaryExport();
  }, [batchActive, handlePrimaryExport, runBatch]);

  const handleToggleBatchMode = useCallback(() => {
    if (isBatchRunning) return;
    setBatchEnabled(!batch.enabled);
  }, [batch.enabled, isBatchRunning, setBatchEnabled]);

  const handleToggleBatchSharedSettings = useCallback(() => {
    if (isBatchRunning) return;
    setBatchUseSharedSettings(!batch.useSharedSettings);
  }, [batch.useSharedSettings, isBatchRunning, setBatchUseSharedSettings]);

  const batchPrimaryLabel = isBatchRunning
    ? `Encoding ${Math.round(batchOverallProgress)}%`
    : batchFailedCount > 0
      ? `Export ${batch.jobs.length} again`
      : `Export ${batch.jobs.length} files`;

  // If neither encoder is supported, show error
  if (!webCodecsAvailable && !ffmpegAvailable) {
    return (
      <div className="export-panel" role="region" aria-label="Export">
        <div className="panel-header">
          <h3>Export</h3>
        </div>
        <div className="export-error" role="alert">
          No video encoder available. WebCodecs requires Chrome 94+ or Safari 16.4+.
          FFmpeg WASM requires WebAssembly support.
        </div>
      </div>
    );
  }

  return (
    <div
      className="export-panel"
      ref={panelRef}
      role="region"
      aria-label="Export"
      aria-busy={isExporting || isBatchRunning}
      onDragOver={handleBatchDragOver}
      onDragLeave={handleBatchDragLeave}
      onDrop={handleBatchDrop}
    >
      {isBatchDragOver && (
        <div className="export-batch-drop-overlay">
          Add media to batch export
        </div>
      )}
      {!isExporting ? (
        <div className="export-form">
          <div className="export-top-stack">
            <ExportSummaryBadgesSection
              showCompositionSync={!batchActive && (isVideoMode || isImageMode)}
              sameAsComposition={sameAsComposition}
              summaryBadges={summaryBadges}
              primaryExportLabel={batchActive ? batchPrimaryLabel : primaryExportLabel}
              estimatedSizeLabel={estimatedSizeLabel}
              exportDisabled={exportDisabled || (!batchActive && isVideoMode && storyboardExportGuard.blocked)}
              onPrimaryExport={handlePanelPrimaryExport}
              onSyncComposition={syncCompositionSettings}
              onScrollToSummaryTarget={scrollToSummaryTarget}
            />

            <BatchExportQueue
              jobs={batch.jobs}
              selectedJobId={batch.selectedJobId}
              enabled={batch.enabled}
              useSharedSettings={batch.useSharedSettings}
              runtimeByJob={runtimeByJob}
              isRunning={isBatchRunning}
              onToggleEnabled={handleToggleBatchMode}
              onToggleSharedSettings={handleToggleBatchSharedSettings}
              onSelectJob={setSelectedBatchJobId}
              onRemoveJob={removeBatchJob}
              onClear={clearBatchJobs}
              onCancel={cancelBatch}
            />
          </div>

          <div className="export-settings-body" inert={isBatchRunning ? true : undefined}>
            {!batchActive && isVideoMode && hasStoryboardScenesInRange && (
              <StoryboardExportModeControl
                mode={storyboardExportMode}
                warnings={storyboardExportGuard.warnings}
                onChange={setStoryboardExportMode}
              />
            )}

            <ExportPresetCommandSection
              presets={presets}
              selectedPresetId={selectedPresetId}
              setupStatus={setupStatus}
              onSelectPreset={setSelectedPresetId}
              onLoad={loadSavedSetup}
              onUpdate={updateCurrentSetup}
              onSave={saveCurrentSetup}
            />

            {!batchActive && (
              <ExportWorkflowSection
                encoder={encoder}
                webCodecsAvailable={webCodecsAvailable}
                ffmpegAvailable={ffmpegAvailable}
                isFFmpegMultiThreaded={isFFmpegMultiThreaded}
                isFFmpegReady={isFFmpegReady}
                isFFmpegLoading={isFFmpegLoading}
                ffmpegLoadError={ffmpegLoadError}
                onSetEncoder={setEncoder}
                onLoadFFmpeg={loadFFmpeg}
              />
            )}

            <ExportBasicsSection
              filename={filename}
              filenameLocked={batchActive && batch.useSharedSettings}
              sourceMediaType={batchActive ? selectedBatchSourceType : undefined}
              mode={basicsMode}
              display={basicsDisplay}
              video={basicsVideo}
              image={basicsImage}
              gif={basicsGif}
              audio={basicsAudio}
              options={basicsOptions}
              time={basicsTime}
              useInOut={useInOut}
              actions={basicsActions}
            />

            <ExportAdvancedSections
              filename={filename}
              mode={basicsMode}
              display={basicsDisplay}
              video={basicsVideo}
              gif={basicsGif}
              audio={basicsAudio}
              options={basicsOptions}
              actions={basicsActions}
            />

            <ExportAdvancedSummarySections
              encoder={encoder}
              isGifMode={isGifMode}
              stackedAlpha={stackedAlpha}
              setStackedAlpha={setStackedAlpha}
              actualWidth={actualWidth}
              actualHeight={actualHeight}
              outputHeight={outputHeight}
              useInOut={useInOut}
              setUseInOut={setUseInOut}
              startTime={startTime}
              endTime={endTime}
              frameCount={frameCount}
              estimatedSizeLabel={estimatedSizeLabel}
              error={error}
              formatTime={formatTime}
              fixedSourceRange={batchActive}
            />
          </div>
        </div>
      ) : (
        <ExportProgressView
          encoder={encoder}
          progress={progress}
          ffmpegProgress={ffmpegProgress}
          exportPhase={exportPhase}
          usesBrowserProgress={usesBrowserProgress}
          isImageSequenceMode={isImageSequenceMode}
          isGifMode={isGifMode}
          formatTime={formatTime}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
