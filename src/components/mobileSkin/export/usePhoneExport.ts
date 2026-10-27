// Phone export state machine: idle -> preparing -> exporting -> done | failed | cancelled.
// It drives the same service-level runner as the desktop export controller (gate, timeline export
// lock, linked-media connection, wake lock) but keeps the result for a Share/Save click instead of
// downloading it. The Blob lives in React state of this hook only, never in a store.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportSubmissionGate } from '../../export/ExportSubmissionGate';
import { runWebCodecsExport } from '../../export/runners/webCodecsExportRunner';
import { useExportScreenWakeLock } from '../../../hooks/useExportScreenWakeLock';
import { AudioEncoderWrapper } from '../../../engine/audio';
import { FrameExporter } from '../../../engine/export';
import { Logger } from '../../../services/logger';
import { withTimelineLinkedMedia } from '../../../services/project/repository/transaction/editorLinkedMediaConnection';
import { useExportStore } from '../../../stores/exportStore';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { normalizeExportRenderQuality } from '../../../types/renderSettings';
import {
  buildPhoneExportPlan,
  resolvePhoneExportFps,
  resolvePhoneExportSize,
  type PhoneExportCapabilities,
  type PhoneExportPlan,
} from './phoneExportPlan';

const log = Logger.create('PhoneExport');

export type PhoneExportState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'exporting'; progress: number }
  | { status: 'done'; blob: Blob; filename: string; sizeBytes: number; durationSec: number }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

export interface UsePhoneExportResult {
  /** null while the browser capabilities are still being probed. */
  plan: PhoneExportPlan | null;
  state: PhoneExportState;
  /** True from Cancel until the runner has cleaned up. */
  cancelling: boolean;
  start: () => Promise<void>;
  cancel: () => Promise<void>;
  /** Back to idle (drops a finished result); ignored while an export runs. */
  reset: () => void;
}

interface ProbedCapabilities {
  key: string;
  capabilities: PhoneExportCapabilities;
}

let audioProbe: Promise<'aac' | 'opus' | null> | null = null;

function probeAudioCodec(): Promise<'aac' | 'opus' | null> {
  audioProbe ??= AudioEncoderWrapper.detectSupportedCodec()
    .then((result) => result?.codec ?? null)
    .catch((error) => {
      log.warn('Audio encoder probe failed', error);
      return null;
    });
  return audioProbe;
}

async function probeCapabilities(width: number, height: number, fps: number): Promise<PhoneExportCapabilities> {
  const exporterSupported = FrameExporter.isSupported();
  if (!exporterSupported) return { exporterSupported, h264: false, audioCodec: null };
  const [h264, audioCodec] = await Promise.all([
    FrameExporter.checkCodecSupport('h264', width, height, fps).catch(() => false),
    probeAudioCodec(),
  ]);
  const vp9 = h264 ? false : await FrameExporter.checkCodecSupport('vp9', width, height, fps).catch(() => false);
  return { exporterSupported, h264, vp9, audioCodec };
}

function safeFilenameBase(projectName: string | undefined): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = (projectName ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').trim();
  return cleaned || 'MasterSelects export';
}

function pauseTimelinePlayback(): void {
  const timeline = useTimelineStore.getState();
  if (timeline.isPlaying) timeline.pause();
}

export function usePhoneExport(): UsePhoneExportResult {
  const composition = useMediaStore((store) => store.compositions.find((c) => c.id === store.activeCompositionId));
  const projectName = useMediaStore((store) => store.currentProjectName);
  const clips = useTimelineStore((store) => store.clips);
  const tracks = useTimelineStore((store) => store.tracks);
  const inPoint = useTimelineStore((store) => store.inPoint);
  const outPoint = useTimelineStore((store) => store.outPoint);

  const [state, setState] = useState<PhoneExportState>({ status: 'idle' });
  const [cancelling, setCancelling] = useState(false);
  const [probed, setProbed] = useState<ProbedCapabilities | null>(null);

  const gateRef = useRef(new ExportSubmissionGate());
  const exporterRef = useRef<InstanceType<typeof FrameExporter> | null>(null);
  const runRef = useRef<Promise<void> | null>(null);
  const cancelRequestedRef = useRef(false);
  const mountedRef = useRef(true);

  useExportScreenWakeLock(state.status === 'preparing' || state.status === 'exporting');

  const compositionSize = useMemo(() => {
    if (!composition) return null;
    const size = resolvePhoneExportSize(composition);
    return { width: size.width, height: size.height, fps: resolvePhoneExportFps(composition) };
  }, [composition]);
  const probeKey = compositionSize ? `${compositionSize.width}x${compositionSize.height}@${compositionSize.fps}` : null;

  useEffect(() => {
    if (!compositionSize || !probeKey) return undefined;
    let active = true;
    void probeCapabilities(compositionSize.width, compositionSize.height, compositionSize.fps).then((capabilities) => {
      if (active) setProbed({ key: probeKey, capabilities });
    });
    return () => { active = false; };
  }, [compositionSize, probeKey]);

  const plan = useMemo<PhoneExportPlan | null>(() => {
    if (!composition) return buildPhoneExportPlan({
      composition: null, clips: [], tracks: [], inPoint: null, outPoint: null,
      capabilities: { exporterSupported: true, h264: false, audioCodec: null },
    });
    if (!probed || probed.key !== probeKey) return null;
    return buildPhoneExportPlan({
      composition,
      clips,
      tracks,
      inPoint,
      outPoint,
      capabilities: probed.capabilities,
    });
  }, [clips, composition, inPoint, outPoint, probeKey, probed, tracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      exporterRef.current?.cancel();
    };
  }, []);

  const publish = useCallback((next: PhoneExportState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const start = useCallback(async () => {
    if (runRef.current) return;
    if (!plan || !plan.supported) {
      publish({ status: 'failed', message: plan ? plan.reason : 'Still checking what this browser can encode.' });
      return;
    }
    const exportPlan = plan;
    cancelRequestedRef.current = false;
    setCancelling(false);
    publish({ status: 'preparing' });

    const run = gateRef.current.run(async () => {
      pauseTimelinePlayback();
      const timeline = useTimelineStore.getState();
      timeline.startExport(exportPlan.startTime, exportPlan.endTime);
      try {
        if (cancelRequestedRef.current) {
          publish({ status: 'cancelled' });
          return;
        }
        const result = await withTimelineLinkedMedia(runWebCodecsExport, {
          width: exportPlan.width,
          height: exportPlan.height,
          fps: exportPlan.fps,
          startTime: exportPlan.startTime,
          endTime: exportPlan.endTime,
          videoCodec: exportPlan.videoCodec,
          containerFormat: exportPlan.containerFormat,
          bitrate: exportPlan.bitrate,
          rateControl: 'vbr',
          stackedAlpha: false,
          includeAudio: exportPlan.includeAudio,
          audioSampleRate: exportPlan.audioSampleRate,
          audioBitrate: exportPlan.audioBitrate,
          normalizeAudio: false,
          exportMode: 'fast',
          filename: safeFilenameBase(projectName),
          onExporter: (exporter) => {
            exporterRef.current = exporter;
            if (cancelRequestedRef.current) exporter.cancel();
          },
          onProgress: (progress) => {
            const fraction = Math.min(1, Math.max(0, progress.percent / 100));
            publish({ status: 'exporting', progress: Number.isFinite(fraction) ? fraction : 0 });
          },
          onTimelineProgress: (percent, currentTime) => {
            useTimelineStore.getState().setExportProgress(percent, currentTime);
          },
          renderQuality: normalizeExportRenderQuality(useExportStore.getState().settings.renderQuality),
        });

        if (cancelRequestedRef.current || !result) {
          publish({ status: 'cancelled' });
        } else if (result.blob.size === 0) {
          publish({ status: 'failed', message: 'The export produced an empty file. Try again.' });
        } else {
          publish({
            status: 'done',
            blob: result.blob,
            filename: result.filename,
            sizeBytes: result.blob.size,
            durationSec: exportPlan.durationSec,
          });
        }
      } catch (error) {
        if (cancelRequestedRef.current) {
          publish({ status: 'cancelled' });
        } else {
          log.error('Export failed', error);
          publish({ status: 'failed', message: error instanceof Error ? error.message : 'Export failed.' });
        }
      } finally {
        exporterRef.current = null;
        useTimelineStore.getState().endExport();
      }
    });
    runRef.current = run;
    try {
      await run;
    } finally {
      runRef.current = null;
      if (mountedRef.current) setCancelling(false);
    }
  }, [plan, projectName, publish]);

  const cancel = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    exporterRef.current?.cancel();
    // The gate stays closed until the runner has released its decoders and encoders.
    await run;
  }, []);

  const reset = useCallback(() => {
    if (runRef.current) return;
    setState({ status: 'idle' });
  }, []);

  return { plan, state, cancelling, start, cancel, reset };
}
