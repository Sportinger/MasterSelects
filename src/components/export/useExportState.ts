// Export state management hook - uses the shared export store for undo/project persistence

import { useCallback, useEffect, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Logger } from '../../services/logger';
import { FrameExporter } from '../../engine/export';
import type { ExportProgress, VideoCodec, ContainerFormat } from '../../engine/export';
import { AudioEncoderWrapper, type AudioCodec } from '../../engine/audio';
import {
  getFFmpegBridge,
  FFmpegBridge,
  PLATFORM_PRESETS,
  getCodecInfo,
} from '../../engine/ffmpeg';
import type {
  FFmpegProgress,
  FFmpegVideoCodec,
  FFmpegContainer,
  ProResProfile,
  DnxhrProfile,
} from '../../engine/ffmpeg';
import type { Composition } from '../../stores/mediaStore';
import {
  useExportStore,
  type ExportEncoderType,
  type ExportImageFormat,
  type ExportSpecialContainer,
  type ExportVisualMode,
} from '../../stores/exportStore';

const log = Logger.create('ExportState');

export type EncoderType = ExportEncoderType;

export function useExportState(_composition: Composition | undefined) {
  const {
    settings,
    setSettings,
  } = useExportStore(useShallow((state) => ({
    settings: state.settings,
    setSettings: state.setSettings,
  })));

  const {
    encoder,
    width,
    height,
    customWidth,
    customHeight,
    useCustomResolution,
    fps,
    customFps,
    useCustomFps,
    useInOut,
    filename,
    bitrate,
    containerFormat,
    videoCodec,
    rateControl,
    ffmpegCodec,
    ffmpegContainer,
    ffmpegPreset,
    proresProfile,
    dnxhrProfile,
    ffmpegQuality,
    ffmpegBitrate,
    ffmpegRateControl,
    stackedAlpha,
    includeAudio,
    audioSampleRate,
    audioBitrate,
    normalizeAudio,
    videoEnabled,
    visualMode,
    imageFormat,
    imageQuality,
    specialContainer,
  } = settings;

  const [codecSupport, setCodecSupport] = useState<Record<VideoCodec, boolean>>({
    h264: true,
    h265: false,
    vp9: false,
    av1: false,
  });
  const [isFFmpegLoading, setIsFFmpegLoading] = useState(false);
  const [isFFmpegReady, setIsFFmpegReady] = useState(false);
  const [ffmpegLoadError, setFfmpegLoadError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [ffmpegProgress, setFfmpegProgress] = useState<FFmpegProgress | null>(null);
  const [exportPhase, setExportPhase] = useState<'idle' | 'rendering' | 'audio' | 'encoding'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [exporter, setExporter] = useState<FrameExporter | null>(null);
  const [isSupported, setIsSupported] = useState(true);
  const [isAudioSupported, setIsAudioSupported] = useState(true);
  const [audioCodec, setAudioCodec] = useState<AudioCodec | null>(null);

  const isFFmpegSupported = FFmpegBridge.isSupported();
  const isFFmpegMultiThreaded = FFmpegBridge.isMultiThreaded();

  useEffect(() => {
    setIsSupported(FrameExporter.isSupported());
    AudioEncoderWrapper.detectSupportedCodec().then(result => {
      if (result) {
        setIsAudioSupported(true);
        setAudioCodec(result.codec);
        log.info(`Audio codec detected: ${result.codec.toUpperCase()}`);
      } else {
        setIsAudioSupported(false);
        setSettings({ includeAudio: false });
        log.warn('No audio encoding supported in this browser');
      }
    });
  }, [setSettings]);

  useEffect(() => {
    const checkSupport = async () => {
      const actualWidth = useCustomResolution ? customWidth : width;
      const actualHeight = useCustomResolution ? customHeight : height;
      const support: Record<VideoCodec, boolean> = {
        h264: await FrameExporter.checkCodecSupport('h264', actualWidth, actualHeight),
        h265: await FrameExporter.checkCodecSupport('h265', actualWidth, actualHeight),
        vp9: await FrameExporter.checkCodecSupport('vp9', actualWidth, actualHeight),
        av1: await FrameExporter.checkCodecSupport('av1', actualWidth, actualHeight),
      };
      setCodecSupport(support);

      const availableCodecs = FrameExporter.getVideoCodecs(containerFormat);
      if (!support[videoCodec]) {
        const firstSupported = availableCodecs.find(c => support[c.id]);
        if (firstSupported) {
          setSettings({ videoCodec: firstSupported.id });
        }
      }
    };

    void checkSupport();
  }, [containerFormat, customHeight, customWidth, setSettings, useCustomResolution, videoCodec, width, height]);

  useEffect(() => {
    const availableCodecs = FrameExporter.getVideoCodecs(containerFormat);
    if (!availableCodecs.find(c => c.id === videoCodec)) {
      setSettings({ videoCodec: availableCodecs[0].id });
    }
  }, [containerFormat, setSettings, videoCodec]);

  const handleResolutionChange = useCallback((value: string) => {
    const [nextWidth, nextHeight] = value.split('x').map(Number);
    setSettings({ width: nextWidth, height: nextHeight });
  }, [setSettings]);

  const loadFFmpeg = useCallback(async () => {
    if (isFFmpegReady) return;

    setIsFFmpegLoading(true);
    setFfmpegLoadError(null);

    try {
      const ffmpeg = getFFmpegBridge();
      await ffmpeg.load();
      setIsFFmpegReady(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load FFmpeg';
      setFfmpegLoadError(msg);
      log.error('FFmpeg load error', e);
    } finally {
      setIsFFmpegLoading(false);
    }
  }, [isFFmpegReady]);

  const applyFFmpegPreset = useCallback((presetId: string) => {
    const presetConfig = PLATFORM_PRESETS[presetId];
    if (!presetConfig) {
      setSettings({ ffmpegPreset: '' });
      return;
    }

    const patch: Partial<typeof settings> = {
      ffmpegCodec: presetConfig.codec,
      ffmpegContainer: presetConfig.container,
      ffmpegPreset: presetId,
    };

    if (presetConfig.quality !== undefined) {
      patch.ffmpegRateControl = 'crf';
      patch.ffmpegQuality = presetConfig.quality;
    }
    if (presetConfig.bitrate !== undefined) {
      patch.ffmpegRateControl = 'vbr';
      patch.ffmpegBitrate = presetConfig.bitrate;
    }
    if (presetConfig.proresProfile) {
      patch.proresProfile = presetConfig.proresProfile;
    }
    if (presetConfig.dnxhrProfile) {
      patch.dnxhrProfile = presetConfig.dnxhrProfile;
    }

    setSettings(patch);
  }, [setSettings, settings]);

  const handleFFmpegContainerChange = useCallback((newContainer: FFmpegContainer) => {
    const patch: Partial<typeof settings> = {
      ffmpegContainer: newContainer,
      ffmpegPreset: '',
    };

    const codecInfo = getCodecInfo(ffmpegCodec);
    if (codecInfo && !codecInfo.containers.includes(newContainer)) {
      if (newContainer === 'mxf') {
        patch.ffmpegCodec = 'dnxhd';
      } else if (newContainer === 'mov') {
        patch.ffmpegCodec = 'prores';
      } else if (newContainer === 'mkv' || newContainer === 'avi') {
        patch.ffmpegCodec = 'mjpeg';
      }
    }

    setSettings(patch);
  }, [ffmpegCodec, setSettings, settings]);

  const handleFFmpegCodecChange = useCallback((newCodec: FFmpegVideoCodec) => {
    const patch: Partial<typeof settings> = {
      ffmpegCodec: newCodec,
      ffmpegPreset: '',
    };

    const codecInfo = getCodecInfo(newCodec);
    if (codecInfo && !codecInfo.containers.includes(ffmpegContainer)) {
      patch.ffmpegContainer = codecInfo.containers[0];
    }

    setSettings(patch);
  }, [ffmpegContainer, setSettings, settings]);

  return {
    encoder,
    setEncoder: (value: EncoderType) => setSettings({ encoder: value }),
    width,
    setWidth: (value: number) => setSettings({ width: value }),
    height,
    setHeight: (value: number) => setSettings({ height: value }),
    customWidth,
    setCustomWidth: (value: number) => setSettings({ customWidth: value }),
    customHeight,
    setCustomHeight: (value: number) => setSettings({ customHeight: value }),
    useCustomResolution,
    setUseCustomResolution: (value: boolean) => setSettings({ useCustomResolution: value }),
    fps,
    setFps: (value: number) => setSettings({ fps: value }),
    customFps,
    setCustomFps: (value: number) => setSettings({ customFps: value }),
    useCustomFps,
    setUseCustomFps: (value: boolean) => setSettings({ useCustomFps: value }),
    useInOut,
    setUseInOut: (value: boolean) => setSettings({ useInOut: value }),
    filename,
    setFilename: (value: string) => setSettings({ filename: value }),
    bitrate,
    setBitrate: (value: number) => setSettings({ bitrate: value }),
    containerFormat,
    setContainerFormat: (value: ContainerFormat) => setSettings({ containerFormat: value }),
    videoCodec,
    setVideoCodec: (value: VideoCodec) => setSettings({ videoCodec: value }),
    codecSupport,
    rateControl,
    setRateControl: (value: 'vbr' | 'cbr') => setSettings({ rateControl: value }),
    ffmpegCodec,
    setFfmpegCodec: (value: FFmpegVideoCodec) => setSettings({ ffmpegCodec: value }),
    ffmpegContainer,
    setFfmpegContainer: (value: FFmpegContainer) => setSettings({ ffmpegContainer: value }),
    ffmpegPreset,
    proresProfile,
    setProresProfile: (value: ProResProfile) => setSettings({ proresProfile: value }),
    dnxhrProfile,
    setDnxhrProfile: (value: DnxhrProfile) => setSettings({ dnxhrProfile: value }),
    ffmpegQuality,
    setFfmpegQuality: (value: number) => setSettings({ ffmpegQuality: value }),
    ffmpegBitrate,
    setFfmpegBitrate: (value: number) => setSettings({ ffmpegBitrate: value }),
    ffmpegRateControl,
    setFfmpegRateControl: (value: 'crf' | 'cbr' | 'vbr') => setSettings({ ffmpegRateControl: value }),
    isFFmpegLoading,
    isFFmpegReady,
    ffmpegLoadError,
    stackedAlpha,
    setStackedAlpha: (value: boolean) => setSettings({ stackedAlpha: value }),
    includeAudio,
    setIncludeAudio: (value: boolean) => setSettings({ includeAudio: value }),
    audioSampleRate,
    setAudioSampleRate: (value: 44100 | 48000) => setSettings({ audioSampleRate: value }),
    audioBitrate,
    setAudioBitrate: (value: number) => setSettings({ audioBitrate: value }),
    normalizeAudio,
    setNormalizeAudio: (value: boolean) => setSettings({ normalizeAudio: value }),
    videoEnabled,
    setVideoEnabled: (value: boolean) => setSettings({ videoEnabled: value }),
    visualMode,
    setVisualMode: (value: ExportVisualMode) => setSettings({ visualMode: value }),
    imageFormat,
    setImageFormat: (value: ExportImageFormat) => setSettings({ imageFormat: value }),
    imageQuality,
    setImageQuality: (value: number) => setSettings({ imageQuality: value }),
    specialContainer,
    setSpecialContainer: (value: ExportSpecialContainer) => setSettings({ specialContainer: value }),
    isExporting,
    setIsExporting,
    progress,
    setProgress,
    ffmpegProgress,
    setFfmpegProgress,
    exportPhase,
    setExportPhase,
    error,
    setError,
    exporter,
    setExporter,
    isSupported,
    isAudioSupported,
    audioCodec,
    isFFmpegSupported,
    isFFmpegMultiThreaded,
    handleResolutionChange,
    loadFFmpeg,
    applyFFmpegPreset,
    handleFFmpegContainerChange,
    handleFFmpegCodecChange,
  };
}
