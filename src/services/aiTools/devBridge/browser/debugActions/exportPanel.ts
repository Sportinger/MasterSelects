import { useDockStore } from '../../../../../stores/dockStore';
import { useExportStore } from '../../../../../stores/exportStore';
import { useTimelineStore } from '../../../../../stores/timeline';
import type { ContainerFormat, VideoCodec } from '../../../../../engine/export';
import type { ExportSettings } from '../../../../../stores/exportStore';
import { exportDiagnostics } from '../../../../export/exportDiagnostics';
import { exportGpuPhaseDiagnostics } from '../../../../export/exportGpuPhaseDiagnostics';

const waitForExportProbe = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function cloneForExportProbe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function summarizeExportPanelForProbe() {
  const panel = document.querySelector<HTMLElement>('.export-panel');
  const button = panel?.querySelector<HTMLButtonElement>('.export-summary-cta') ?? null;
  const progress = panel?.querySelector<HTMLElement>('.export-progress-container') ?? null;
  const error = panel?.querySelector<HTMLElement>('.export-error') ?? null;
  return {
    panelVisible: Boolean(panel),
    buttonText: button?.textContent?.trim() ?? null,
    buttonDisabled: button?.disabled ?? null,
    progressVisible: Boolean(progress),
    progressText: progress?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
    errorText: error?.textContent?.replace(/\s+/g, ' ').trim() ?? null,
  };
}

export async function startCurrentExportFromPanel() {
  if (useTimelineStore.getState().isExporting) {
    return {
      success: false,
      error: 'An export is already running.',
      data: summarizeExportPanelForProbe(),
    };
  }

  useDockStore.getState().activatePanelType('export');
  await waitForExportProbe(180);

  const beforeClick = summarizeExportPanelForProbe();
  const button = document.querySelector<HTMLButtonElement>(
    '.export-panel .export-summary-cta',
  );
  if (!button) {
    return {
      success: false,
      error: 'Export button was not found after opening the Export panel.',
      data: { beforeClick },
    };
  }
  if (button.disabled) {
    return {
      success: false,
      error: 'Export button is disabled.',
      data: { beforeClick },
    };
  }

  button.click();
  await waitForExportProbe(150);

  const timeline = useTimelineStore.getState();
  return {
    success: timeline.isExporting,
    ...(!timeline.isExporting ? { error: 'Export did not enter the running state.' } : {}),
    data: {
      beforeClick,
      afterClick: summarizeExportPanelForProbe(),
      timelineExportState: {
        isExporting: timeline.isExporting,
        exportProgress: timeline.exportProgress,
        exportCurrentTime: timeline.exportCurrentTime,
        inPoint: timeline.inPoint,
        outPoint: timeline.outPoint,
      },
      settings: cloneForExportProbe(useExportStore.getState().settings),
    },
  };
}

export function getCurrentExportPanelState() {
  const timeline = useTimelineStore.getState();
  return {
    success: true,
    data: {
      panel: summarizeExportPanelForProbe(),
      timelineExportState: {
        isExporting: timeline.isExporting,
        exportProgress: timeline.exportProgress,
        exportCurrentTime: timeline.exportCurrentTime,
        inPoint: timeline.inPoint,
        outPoint: timeline.outPoint,
      },
    },
  };
}

function pickExportProbeValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && allowed.includes(value as T) ? value as T : fallback;
}

export async function runExportPanelButtonProbe(args: Record<string, unknown> = {}) {
  const timeoutMs = typeof args.timeoutMs === 'number' && Number.isFinite(args.timeoutMs)
    ? Math.max(5000, Math.min(120000, Math.round(args.timeoutMs)))
    : 60000;
  const startTime = typeof args.startTime === 'number' && Number.isFinite(args.startTime)
    ? Math.max(0, args.startTime)
    : 12.5;
  const durationSeconds = typeof args.durationSeconds === 'number' && Number.isFinite(args.durationSeconds)
    ? Math.max(0.1, Math.min(10, args.durationSeconds))
    : 0.5;
  const width = typeof args.width === 'number' && Number.isFinite(args.width)
    ? Math.max(16, Math.min(7680, Math.round(args.width)))
    : 320;
  const height = typeof args.height === 'number' && Number.isFinite(args.height)
    ? Math.max(16, Math.min(4320, Math.round(args.height)))
    : 180;
  const fps = typeof args.fps === 'number' && Number.isFinite(args.fps)
    ? Math.max(1, Math.min(240, args.fps))
    : 6;
  const filename = typeof args.filename === 'string' && args.filename.trim()
    ? args.filename.trim()
    : 'codex-ui-export-probe';
  const includeAudio = args.includeAudio !== false;
  const exportMode = args.exportMode === 'precise' ? 'precise' : 'fast';
  const containerFormat = pickExportProbeValue<ContainerFormat>(
    args.containerFormat ?? args.container,
    ['mp4', 'webm'],
    'mp4',
  );
  const fallbackCodec: VideoCodec = containerFormat === 'webm' ? 'vp9' : 'h264';
  const videoCodec = pickExportProbeValue<VideoCodec>(
    args.videoCodec ?? args.codec,
    ['h264', 'h265', 'vp9', 'av1'],
    fallbackCodec,
  );
  const bitrate = typeof args.bitrate === 'number' && Number.isFinite(args.bitrate)
    ? Math.max(1_000_000, Math.min(100_000_000, Math.round(args.bitrate)))
    : undefined;
  const gpuPhaseBreakdown = args.gpuPhaseBreakdown === true;
  const requestedRenderHostMode = args.renderHostMode === 'main'
    ? 'main'
    : args.renderHostMode === 'worker-only' || args.renderHostMode === 'worker-software'
      ? args.renderHostMode
      : null;
  const renderHostModeStorageKey = 'masterselects.renderHostMode';
  const originalRenderHostMode = window.localStorage.getItem(renderHostModeStorageKey);
  const rateControl = pickExportProbeValue<ExportSettings['rateControl']>(
    args.rateControl,
    ['vbr', 'cbr'],
    'vbr',
  );
  const downloadClickCountBefore = document.querySelectorAll('a[download]').length;
  const exportStore = useExportStore.getState();
  const timeline = useTimelineStore.getState();
  const originalSettings = cloneForExportProbe(exportStore.settings);
  const originalRange = { inPoint: timeline.inPoint, outPoint: timeline.outPoint };
  const startedAt = performance.now();
  const runtimeErrors: string[] = [];
  const windowErrorHandler = (event: ErrorEvent) => {
    runtimeErrors.push(event.message);
  };
  const rejectionHandler = (event: PromiseRejectionEvent) => {
    runtimeErrors.push(event.reason instanceof Error ? event.reason.message : String(event.reason));
  };

  window.addEventListener('error', windowErrorHandler);
  window.addEventListener('unhandledrejection', rejectionHandler);

  try {
    if (requestedRenderHostMode) {
      window.localStorage.setItem(renderHostModeStorageKey, requestedRenderHostMode);
    }
    if (gpuPhaseBreakdown) {
      exportGpuPhaseDiagnostics.start();
    }
    useDockStore.getState().activatePanelType('export');
    await waitForExportProbe(180);

    exportStore.setSettings({
      encoder: exportMode === 'precise' ? 'htmlvideo' : 'webcodecs',
      width,
      height,
      customWidth: width,
      customHeight: height,
      useCustomResolution: true,
      fps,
      customFps: fps,
      useCustomFps: true,
      useInOut: true,
      filename,
      ...(bitrate ? { bitrate } : {}),
      rateControl,
      containerFormat,
      videoCodec,
      includeAudio,
      videoEnabled: true,
      visualMode: 'video',
      specialContainer: 'none',
      stackedAlpha: false,
    });
    // Clear the old range first. Setting a new in-point beyond the previous
    // out-point is otherwise clamped to that stale out-point.
    timeline.setInPoint(null);
    timeline.setOutPoint(startTime + durationSeconds);
    timeline.setInPoint(startTime);
    await waitForExportProbe(250);

    const beforeClick = summarizeExportPanelForProbe();
    const button = document.querySelector<HTMLButtonElement>('.export-panel .export-summary-cta');
    if (!button) {
      return {
        success: false,
        error: 'Export button was not found after opening the Export panel.',
        data: {
          beforeClick,
          dockLayout: useDockStore.getState().layout,
        },
      };
    }
    if (button.disabled) {
      return {
        success: false,
        error: 'Export button is disabled.',
        data: { beforeClick },
      };
    }

    button.click();
    await waitForExportProbe(100);

    let finalPanel = summarizeExportPanelForProbe();
    let lastExporting = useTimelineStore.getState().isExporting;
    let completed = false;
    let failed = false;

    while (performance.now() - startedAt < timeoutMs) {
      await waitForExportProbe(250);
      finalPanel = summarizeExportPanelForProbe();
      lastExporting = useTimelineStore.getState().isExporting;
      failed = Boolean(finalPanel.errorText) || runtimeErrors.length > 0;
      completed = !lastExporting && !finalPanel.progressVisible;
      if (failed || completed) break;
    }

    const exportAfter = useTimelineStore.getState();
    return {
      success: completed && !failed,
      ...(failed ? { error: finalPanel.errorText ?? runtimeErrors[0] ?? 'Export failed during UI probe.' } : {}),
      data: {
        action: 'probe-export-panel-button',
        elapsedMs: Math.round(performance.now() - startedAt),
        timeoutMs,
        settings: {
          startTime,
          endTime: startTime + durationSeconds,
          width,
          height,
          fps,
          includeAudio,
          exportMode,
          filename,
          containerFormat,
          videoCodec,
          bitrate: bitrate ?? originalSettings.bitrate,
          rateControl,
          renderHostMode: requestedRenderHostMode ?? originalRenderHostMode ?? 'default-main',
        },
        beforeClick,
        after: finalPanel,
        runtimeErrors,
        timelineExportState: {
          isExporting: exportAfter.isExporting,
          exportProgress: exportAfter.exportProgress,
          exportCurrentTime: exportAfter.exportCurrentTime,
        },
        exportDiagnostics: exportDiagnostics.snapshot(),
        ...(gpuPhaseBreakdown
          ? { exportGpuPhaseDiagnostics: exportGpuPhaseDiagnostics.snapshot() }
          : {}),
        downloadAnchorCountDelta: document.querySelectorAll('a[download]').length - downloadClickCountBefore,
      },
    };
  } finally {
    if (gpuPhaseBreakdown) {
      exportGpuPhaseDiagnostics.stop();
    }
    if (requestedRenderHostMode) {
      if (originalRenderHostMode === null) {
        window.localStorage.removeItem(renderHostModeStorageKey);
      } else {
        window.localStorage.setItem(renderHostModeStorageKey, originalRenderHostMode);
      }
    }
    window.removeEventListener('error', windowErrorHandler);
    window.removeEventListener('unhandledrejection', rejectionHandler);
    timeline.endExport();
    timeline.setInPoint(originalRange.inPoint);
    timeline.setOutPoint(originalRange.outPoint);
    exportStore.replaceSettings(originalSettings);
  }
}

export async function probeVideoEncoderConfigs(args: Record<string, unknown> = {}) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) {
    return { success: false, error: 'WebCodecs VideoEncoder/VideoFrame is not available.' };
  }

  const width = typeof args.width === 'number' && Number.isFinite(args.width)
    ? Math.max(16, Math.min(7680, Math.round(args.width)))
    : 1920;
  const height = typeof args.height === 'number' && Number.isFinite(args.height)
    ? Math.max(16, Math.min(4320, Math.round(args.height)))
    : 1080;
  const fps = typeof args.fps === 'number' && Number.isFinite(args.fps)
    ? Math.max(1, Math.min(240, args.fps))
    : 30;
  const bitrate = typeof args.bitrate === 'number' && Number.isFinite(args.bitrate)
    ? Math.max(1_000_000, Math.min(100_000_000, Math.round(args.bitrate)))
    : 15_000_000;
  const codecStrings = Array.isArray(args.codecStrings)
    ? args.codecStrings.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : ['avc1.4d0028', 'avc1.640028', 'avc1.42e028', 'avc1.4d401f', 'avc1.42e01f'];
  const hardwareModes: VideoEncoderConfig['hardwareAcceleration'][] = ['prefer-hardware', 'no-preference', 'prefer-software'];
  const latencyModes: VideoEncoderConfig['latencyMode'][] = ['realtime', 'quality'];
  const bitrateModes: VideoEncoderBitrateMode[] = ['variable', 'constant'];
  const results: Array<Record<string, unknown>> = [];
  const frameBytes = new Uint8Array(width * height * 4);
  for (let index = 0; index < frameBytes.length; index += 4) {
    frameBytes[index] = 24;
    frameBytes[index + 1] = 32;
    frameBytes[index + 2] = 44;
    frameBytes[index + 3] = 255;
  }

  for (const codec of codecStrings) {
    for (const hardwareAcceleration of hardwareModes) {
      for (const latencyMode of latencyModes) {
        for (const bitrateMode of bitrateModes) {
          const config: VideoEncoderConfig = {
            codec,
            width,
            height,
            bitrate,
            framerate: fps,
            hardwareAcceleration,
            latencyMode,
            bitrateMode,
            contentHint: 'motion',
          };
          const startedAt = performance.now();
          let outputCount = 0;
          let encoderError: string | null = null;
          let supported: boolean | null = null;
          let ok = false;
          let stage = 'support';
          let encoder: VideoEncoder | null = null;

          try {
            const support = await VideoEncoder.isConfigSupported(config);
            supported = support.supported ?? false;
            if (!supported) {
              results.push({ codec, hardwareAcceleration, latencyMode, bitrateMode, supported, ok, stage, elapsedMs: Math.round(performance.now() - startedAt) });
              continue;
            }

            stage = 'configure';
            encoder = new VideoEncoder({
              output: () => { outputCount += 1; },
              error: (error) => { encoderError = error instanceof Error ? error.message : String(error); },
            });
            encoder.configure(config);

            stage = 'encode';
            const frame = new VideoFrame(frameBytes, {
              format: 'RGBA',
              codedWidth: width,
              codedHeight: height,
              timestamp: 0,
              duration: Math.round(1_000_000 / fps),
            });
            encoder.encode(frame, { keyFrame: true });
            frame.close();

            stage = 'flush';
            await Promise.race([
              encoder.flush(),
              waitForExportProbe(5000).then(() => {
                throw new Error('flush timeout');
              }),
            ]);
            ok = !encoderError && outputCount > 0;
          } catch (error) {
            encoderError = error instanceof Error ? error.message : String(error);
          } finally {
            try {
              encoder?.close();
            } catch {
              // Some failed Safari encoders are already closed.
            }
          }

          results.push({
            codec,
            hardwareAcceleration,
            latencyMode,
            bitrateMode,
            supported,
            ok,
            outputCount,
            stage,
            error: encoderError,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
        }
      }
    }
  }

  return {
    success: results.some((entry) => entry.ok === true),
    data: {
      action: 'probe-video-encoder-configs',
      width,
      height,
      fps,
      bitrate,
      results,
      firstOk: results.find((entry) => entry.ok === true) ?? null,
    },
  };
}
