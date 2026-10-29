// Phone export state machine: idle -> preparing -> exporting -> done | failed | cancelled.
// It drives the same service-level runner as the desktop export controller (gate, timeline export
// lock, linked-media connection, wake lock) but keeps the result for a Share/Save click instead of
// downloading it. The Blob lives in React state of this hook only, never in a store.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ExportSubmissionGate } from '../../export/ExportSubmissionGate';
import { useExportScreenWakeLock } from '../../../hooks/useExportScreenWakeLock';
import { AudioEncoderWrapper } from '../../../engine/audio';
import { FrameExporter } from '../../../engine/export';
import { Logger } from '../../../services/logger';
import { adjustmentLayerExportNotes } from '../../../services/motionDesign/adjustment/adjustmentLayerExportNotes';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { PhoneExportRunSpec } from './phoneExportAdvancedPlan';
import { PhoneExportRunHandle, runPhoneExportSpec } from './phoneExportRun';
import {
  buildPhoneExportPlan,
  resolvePhoneExportFps,
  resolvePhoneExportSize,
  type PhoneExportCapabilities,
  type PhoneExportPlan,
  type PhoneExportPlanReady,
} from './phoneExportPlan';

const log = Logger.create('PhoneExport');

export type PhoneExportState =
  | { status: 'idle' }
  | { status: 'preparing' }
  | { status: 'exporting'; progress: number }
  | { status: 'done'; blob: Blob; filename: string; sizeBytes: number; durationSec: number; shortened: boolean }
  | { status: 'failed'; message: string }
  | { status: 'cancelled' };

export interface UsePhoneExportResult {
  /** null while the browser capabilities are still being probed. */
  plan: PhoneExportPlan | null;
  state: PhoneExportState;
  /** True from Cancel until the runner has cleaned up. */
  cancelling: boolean;
  /** Runs the default plan, or `spec` from the Advanced part when given. */
  start: (spec?: PhoneExportRunSpec | null) => Promise<void>;
  cancel: () => Promise<void>;
  /** Video exports with at least one rendered frame can stop early and keep the rendered part. */
  canFinishEarly: boolean;
  /** True from "Keep rendered part" until the shortened file is ready. */
  finishing: boolean;
  finishEarly: () => void;
  /** Back to idle (drops a finished result); ignored while an export runs. */
  reset: () => void;
}

interface ProbedCapabilities {
  key: string;
  capabilities: PhoneExportCapabilities;
}

let audioProbe: Promise<'aac' | 'opus' | null> | null = null;

export function probeAudioCodec(): Promise<'aac' | 'opus' | null> {
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

/** The default (M1) plan as a run spec: H.264 MP4 (or VP9 WebM) through the WebCodecs runner. */
export function simplePlanToRunSpec(plan: PhoneExportPlanReady): PhoneExportRunSpec {
  return {
    kind: 'webcodecs',
    formatId: plan.containerFormat === 'webm' ? 'webm-vp9' : 'mp4-h264',
    width: plan.width,
    height: plan.height,
    fps: plan.fps,
    startTime: plan.startTime,
    endTime: plan.endTime,
    durationSec: plan.durationSec,
    exportTime: plan.startTime,
    videoCodec: plan.videoCodec,
    container: plan.containerFormat,
    bitrate: plan.bitrate,
    rateControl: 'vbr',
    includeAudio: plan.includeAudio,
    audioFormat: 'browser',
    audioSampleRate: plan.audioSampleRate,
    audioBitrate: plan.audioBitrate,
    imageFormat: 'png',
    ffmpegCodec: 'prores',
    proresProfile: 'hq',
    extension: plan.extension,
    summary: plan.summary,
    notice: plan.notice,
  };
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
  const handleRef = useRef<PhoneExportRunHandle | null>(null);
  const runRef = useRef<Promise<void> | null>(null);
  const cancelRequestedRef = useRef(false);
  const finishRequestedRef = useRef(false);
  const [finishing, setFinishing] = useState(false);
  const [runKind, setRunKind] = useState<PhoneExportRunSpec['kind'] | null>(null);
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
      layerNotes: adjustmentLayerExportNotes(clips),
    });
  }, [clips, composition, inPoint, outPoint, probeKey, probed, tracks]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      handleRef.current?.cancel();
    };
  }, []);

  const publish = useCallback((next: PhoneExportState) => {
    if (mountedRef.current) setState(next);
  }, []);

  const start = useCallback(async (advanced?: PhoneExportRunSpec | null) => {
    if (runRef.current) return;
    if (!advanced && (!plan || !plan.supported)) {
      publish({ status: 'failed', message: plan ? plan.reason : 'Still checking what this browser can encode.' });
      return;
    }
    const spec = advanced ?? simplePlanToRunSpec(plan as PhoneExportPlanReady);
    cancelRequestedRef.current = false;
    finishRequestedRef.current = false;
    setCancelling(false);
    setFinishing(false);
    setRunKind(spec.kind);
    publish({ status: 'preparing' });

    const run = gateRef.current.run(async () => {
      pauseTimelinePlayback();
      const handle = new PhoneExportRunHandle();
      handleRef.current = handle;
      // A still frame has no range; every other kind locks the timeline like the desktop export.
      const locksTimeline = spec.kind !== 'still';
      if (locksTimeline) useTimelineStore.getState().startExport(spec.startTime, spec.endTime);
      try {
        if (cancelRequestedRef.current) {
          publish({ status: 'cancelled' });
          return;
        }
        log.info('Phone export started', { kind: spec.kind, format: spec.formatId, size: `${spec.width}x${spec.height}`, fps: spec.fps });
        const result = await runPhoneExportSpec(spec, handle, {
          filename: safeFilenameBase(projectName),
          onProgress: (progress) => publish({ status: 'exporting', progress }),
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
            durationSec: spec.durationSec,
            shortened: finishRequestedRef.current,
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
        handleRef.current = null;
        if (locksTimeline) useTimelineStore.getState().endExport();
      }
    });
    runRef.current = run;
    try {
      await run;
    } finally {
      runRef.current = null;
      if (mountedRef.current) { setCancelling(false); setFinishing(false); setRunKind(null); }
    }
  }, [plan, projectName, publish]);

  const cancel = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    handleRef.current?.cancel();
    // The gate stays closed until the runner has released its decoders and encoders.
    await run;
  }, []);

  const finishEarly = useCallback(() => {
    if (!runRef.current || finishRequestedRef.current || cancelRequestedRef.current) return;
    if (!handleRef.current?.finishEarly()) {
      log.warn('Keep rendered part was tapped before the runner started');
      return;
    }
    finishRequestedRef.current = true;
    setFinishing(true);
    log.info('Phone export: finishing the file early with the rendered part');
  }, []);

  const canFinishEarly = state.status === 'exporting' && state.progress > 0 && !cancelling && !finishing
    && runKind !== null && PhoneExportRunHandle.supportsFinishEarly(runKind);

  const reset = useCallback(() => {
    if (runRef.current) return;
    setState({ status: 'idle' });
  }, []);

  return { plan, state, cancelling, start, cancel, canFinishEarly, finishing, finishEarly, reset };
}
