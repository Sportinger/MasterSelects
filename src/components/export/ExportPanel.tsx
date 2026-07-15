// Export Panel - embedded panel for frame-by-frame video export

import { useCallback, useRef, useState } from 'react';
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

const log = Logger.create('ExportPanel');

export function ExportPanel() {
  const panelRef = useRef<HTMLDivElement>(null);
  const summaryHighlightTimeoutsRef = useRef<Map<HTMLElement, number>>(new Map());
  const [setupStatus, setSetupStatus] = useState<string | null>(null);
  const { duration, inPoint, outPoint, playheadPosition, startExport, setExportProgress, endExport } = useTimelineStore(useShallow(s => ({
    duration: s.duration,
    inPoint: s.inPoint,
    outPoint: s.outPoint,
    playheadPosition: s.playheadPosition,
    startExport: s.startExport,
    setExportProgress: s.setExportProgress,
    endExport: s.endExport,
  })));
  const { composition, getActiveComposition } = useMediaStore(useShallow(s => ({
    composition: s.compositions.find((candidate) => candidate.id === s.activeCompositionId),
    getActiveComposition: s.getActiveComposition,
  })));
  const {
    presets,
    selectedPresetId,
    setSelectedPresetId,
    savePreset,
    updatePreset,
    loadPreset,
    setSettings,
  } = useExportStore(useShallow((state) => ({
    presets: state.presets,
    selectedPresetId: state.selectedPresetId,
    setSelectedPresetId: state.setSelectedPresetId,
    savePreset: state.savePreset,
    updatePreset: state.updatePreset,
    loadPreset: state.loadPreset,
    setSettings: state.setSettings,
  })));

  // All export state, effects, and simple handlers extracted to hook
  const exportState = useExportState(composition);
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

  // Compute actual start/end based on In/Out markers for display.
  const { startTime, endTime } = resolveExportRange({ duration, inPoint, outPoint }, useInOut);

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
    isExporting,
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
  });

  const handleQuickResolutionPreset = useCallback((value: string) => {
    setUseCustomResolution(false);
    handleResolutionChange(value);
  }, [handleResolutionChange, setUseCustomResolution]);

  const handleQuickFpsPreset = useCallback((value: number) => {
    setUseCustomFps(false);
    setFps(value);
  }, [setFps, setUseCustomFps]);

  const sameAsComposition = !!composition &&
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

  const saveCurrentSetup = useCallback(() => {
    try {
      const suggestedName = selectedPresetName || filename || 'Export Preset';
      const nextName = window.prompt('Preset name', suggestedName);
      if (nextName === null) {
        return;
      }

      const result = savePreset(nextName);
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
  }, [filename, savePreset, selectedPresetName]);

  const updateCurrentSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const updatedPreset = updatePreset(selectedPresetId);
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
  }, [presets.length, selectedPresetId, updatePreset]);

  const loadSavedSetup = useCallback(() => {
    try {
      if (!selectedPresetId) {
        setSetupStatus(presets.length > 0 ? 'Select a preset' : 'No presets saved');
        return;
      }

      const loaded = loadPreset(selectedPresetId);
      setSetupStatus(loaded ? 'Preset loaded' : 'Preset not found');
    } catch (error) {
      log.error('Failed to load export setup', error);
      setSetupStatus('Preset load failed');
    }
  }, [loadPreset, presets.length, selectedPresetId]);

  const scrollToSummaryTarget = useCallback((target: ExportSummaryTarget) => {
    const scrollContainer = panelRef.current?.querySelector<HTMLElement>('.export-form');
    const node = panelRef.current?.querySelector<HTMLElement>(`[data-export-target="${target}"]`);
    if (!scrollContainer || !node) {
      return;
    }

    const containerRect = scrollContainer.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const stickySummaryHeight = panelRef.current?.querySelector<HTMLElement>('.export-summary-sticky')?.offsetHeight ?? 0;
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
    showRangeInVideo,
    showRangeInAudio,
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

  // If neither encoder is supported, show error
  if (!webCodecsAvailable && !ffmpegAvailable) {
    return (
      <div className="export-panel">
        <div className="panel-header">
          <h3>Export</h3>
        </div>
        <div className="export-error">
          No video encoder available. WebCodecs requires Chrome 94+ or Safari 16.4+.
          FFmpeg WASM requires WebAssembly support.
        </div>
      </div>
    );
  }

  return (
    <div className="export-panel" ref={panelRef}>
      {!isExporting ? (
        <div className="export-form">
          <ExportSummaryBadgesSection
            showCompositionSync={isVideoMode || isImageMode}
            sameAsComposition={sameAsComposition}
            summaryBadges={summaryBadges}
            primaryExportLabel={primaryExportLabel}
            estimatedSizeLabel={estimatedSizeLabel}
            exportDisabled={exportDisabled}
            onPrimaryExport={handlePrimaryExport}
            onSyncComposition={syncCompositionSettings}
            onScrollToSummaryTarget={scrollToSummaryTarget}
          />

          <ExportPresetCommandSection
            presets={presets}
            selectedPresetId={selectedPresetId}
            setupStatus={setupStatus}
            onSelectPreset={setSelectedPresetId}
            onLoad={loadSavedSetup}
            onUpdate={updateCurrentSetup}
            onSave={saveCurrentSetup}
          />

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

          <ExportBasicsSection
            filename={filename}
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
          />
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
