// Export Dialog for frame-by-frame video export
// After Effects-style precise rendering

import { useState, useCallback } from 'react';
import { Logger } from '../../services/logger';
import { FrameExporter, downloadBlob } from '../../engine/export';
import type { ExportProgress, VideoCodec, ContainerFormat } from '../../engine/export';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { ExportDialogStyles } from './dialog/ExportDialogStyles';
import { ExportProgressView } from './dialog/ExportProgressView';
import { ExportSettingsForm } from './dialog/ExportSettingsForm';
import { ExportUnsupportedState } from './dialog/ExportUnsupportedState';
import { useExportDialogSupport } from './dialog/useExportDialogSupport';

const log = Logger.create('ExportDialog');

interface ExportDialogProps {
  onClose: () => void;
}

export function ExportDialog({ onClose }: ExportDialogProps) {
  const { duration, startExport, setExportProgress, endExport } = useTimelineStore();
  const { getActiveComposition } = useMediaStore();
  const composition = getActiveComposition();

  const [width, setWidth] = useState(composition?.width ?? 1920);
  const [height, setHeight] = useState(composition?.height ?? 1080);
  const [fps, setFps] = useState(composition?.frameRate ?? 30);
  const [container, setContainer] = useState<ContainerFormat>('mp4');
  const [codec, setCodec] = useState<VideoCodec>('h264');
  const [bitrate, setBitrate] = useState(15_000_000);
  const [useCustomBitrate, setUseCustomBitrate] = useState(false);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(duration);
  const [filename, setFilename] = useState('export');
  const [codecSupport, setCodecSupport] = useState<Record<VideoCodec, boolean>>({
    h264: true,
    h265: false,
    vp9: true,
    av1: false,
  });

  const [stackedAlpha, setStackedAlpha] = useState(false);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [audioSampleRate, setAudioSampleRate] = useState<44100 | 48000>(48000);
  const [audioBitrate, setAudioBitrate] = useState(256000);
  const [normalizeAudio, setNormalizeAudio] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporter, setExporter] = useState<FrameExporter | null>(null);
  const [isSupported, setIsSupported] = useState(true);

  useExportDialogSupport({
    width,
    height,
    fps,
    container,
    codec,
    useCustomBitrate,
    setIsSupported,
    setCodecSupport,
    setBitrate,
    setCodec,
  });

  const handleResolutionChange = useCallback((value: string) => {
    const [w, h] = value.split('x').map(Number);
    setWidth(w);
    setHeight(h);
  }, []);

  const handleExport = useCallback(async () => {
    if (isExporting) return;

    setIsExporting(true);
    setError(null);
    setProgress(null);

    const containerInfo = FrameExporter.getContainerFormats().find(c => c.id === container);
    const extension = containerInfo?.extension ?? '.mp4';

    const exp = new FrameExporter({
      width,
      height,
      fps,
      codec,
      container,
      bitrate,
      startTime,
      endTime,
      stackedAlpha,
      includeAudio,
      audioSampleRate,
      audioBitrate,
      normalizeAudio,
    });
    setExporter(exp);

    startExport(startTime, endTime);

    try {
      const blob = await exp.export((p) => {
        setProgress(p);
        setExportProgress(p.percent, p.currentTime);
      });

      if (blob) {
        downloadBlob(blob, `${filename}${extension}`);
        onClose();
      }
    } catch (e) {
      log.error('Export failed', e);
      setError(e instanceof Error ? e.message : 'Export failed');
    } finally {
      setIsExporting(false);
      setExporter(null);
      endExport();
    }
  }, [width, height, fps, codec, container, bitrate, startTime, endTime, filename, isExporting, onClose, stackedAlpha, includeAudio, audioSampleRate, audioBitrate, normalizeAudio, startExport, setExportProgress, endExport]);

  const handleCancel = useCallback(() => {
    if (exporter) {
      exporter.cancel();
    }
    setIsExporting(false);
    setExporter(null);
    endExport();
  }, [exporter, endExport]);

  if (!isSupported) {
    return <ExportUnsupportedState onClose={onClose} />;
  }

  return (
    <div className="export-dialog-overlay" onClick={onClose}>
      <div className="export-dialog" onClick={(e) => e.stopPropagation()}>
        <h2>Export Video</h2>

        {!isExporting ? (
          <ExportSettingsForm
            filename={filename}
            container={container}
            codec={codec}
            codecSupport={codecSupport}
            width={width}
            height={height}
            fps={fps}
            bitrate={bitrate}
            useCustomBitrate={useCustomBitrate}
            stackedAlpha={stackedAlpha}
            startTime={startTime}
            endTime={endTime}
            duration={duration}
            includeAudio={includeAudio}
            audioSampleRate={audioSampleRate}
            audioBitrate={audioBitrate}
            normalizeAudio={normalizeAudio}
            error={error}
            onClose={onClose}
            onExport={handleExport}
            setFilename={setFilename}
            setContainer={setContainer}
            setCodec={setCodec}
            onResolutionChange={handleResolutionChange}
            setFps={setFps}
            setBitrate={setBitrate}
            setUseCustomBitrate={setUseCustomBitrate}
            setStackedAlpha={setStackedAlpha}
            setStartTime={setStartTime}
            setEndTime={setEndTime}
            setIncludeAudio={setIncludeAudio}
            setAudioSampleRate={setAudioSampleRate}
            setAudioBitrate={setAudioBitrate}
            setNormalizeAudio={setNormalizeAudio}
          />
        ) : (
          <ExportProgressView progress={progress} onCancel={handleCancel} />
        )}
      </div>

      <ExportDialogStyles />
    </div>
  );
}
