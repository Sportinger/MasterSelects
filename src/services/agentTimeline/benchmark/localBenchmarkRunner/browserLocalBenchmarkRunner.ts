import { audioAnalyzer } from '../../../audioAnalyzer';
import { cancelAnalysis, analyzeClip } from '../../../clipAnalyzer';
import {
  cancelTimelineSceneCutAnalysis,
  readTimelineAnalysisClips,
  readTimelineAnalysisMediaFiles,
  readTimelineAnalysisSelectedMediaIds,
  runTimelineSceneCutAnalysis,
} from '../../../timeline/timelineRuntimeCoordinator';
import type {
  LocalBenchmarkBinding,
  LocalBenchmarkCacheObservation,
  LocalBenchmarkExecution,
  LocalBenchmarkObservability,
  LocalBenchmarkRequest,
} from './contracts';
import { LOCAL_BENCHMARK_TOOL } from './contracts';
import { runLocalBenchmarkPass } from './localBenchmarkRunner';

let activeCancel: (() => boolean) | null = null;

export interface BrowserLocalBenchmarkCapabilityHooks {
  /** Must inspect actual local cache/model/artifact state, not infer it from empty UI. */
  verifyColdReset?: (request: LocalBenchmarkRequest, binding: Pick<LocalBenchmarkBinding, 'mediaFileId' | 'clipId'>) => Promise<LocalBenchmarkCacheObservation>;
  /** Must return counters measured for the just-completed local pass. */
  observePass?: (request: LocalBenchmarkRequest, binding: Pick<LocalBenchmarkBinding, 'mediaFileId' | 'clipId'>) => Promise<LocalBenchmarkObservability>;
}

let capabilityHooks: BrowserLocalBenchmarkCapabilityHooks | undefined;

/** Dev-only instrumentation registration. Missing hooks keep benchmark evidence fail-closed. */
export function configureAgentTimelineLocalBenchmarkCapabilities(
  hooks: BrowserLocalBenchmarkCapabilityHooks | undefined,
): void {
  capabilityHooks = hooks;
}

function platform(): string {
  const browserNavigator = navigator as Navigator & { userAgentData?: { platform?: string } };
  return browserNavigator.userAgentData?.platform || navigator.platform || 'unknown';
}

function deviceClass(): string {
  const browserNavigator = navigator as Navigator & { deviceMemory?: number };
  return `browser-${navigator.hardwareConcurrency || 'unknown'}c-${browserNavigator.deviceMemory || 'unknown'}gb`;
}

function selectedMatchingMedia(request: LocalBenchmarkRequest) {
  const selectedIds = readTimelineAnalysisSelectedMediaIds();
  const matches = readTimelineAnalysisMediaFiles().filter((file) => (
    selectedIds.includes(file.id)
    && file.file !== undefined
    && file.file.name === request.mediaFingerprint.name
    && file.file.size === request.mediaFingerprint.sizeBytes
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function matchingClip(mediaFileId: string) {
  const matches = readTimelineAnalysisClips().filter((clip) => (
    (clip.mediaFileId ?? clip.source?.mediaFileId) === mediaFileId
  ));
  return matches.length === 1 ? matches[0] : undefined;
}

function warmObservation(request: LocalBenchmarkRequest, mediaFileId: string, clipId?: string): LocalBenchmarkCacheObservation {
  const mediaFile = readTimelineAnalysisMediaFiles().find((file) => file.id === mediaFileId);
  const clip = clipId ? readTimelineAnalysisClips().find((item) => item.id === clipId) : undefined;
  const cached = request.analyzer === 'cuts'
    ? mediaFile?.sceneCutStatus === 'ready' && Boolean(mediaFile.sceneCutAnalysis)
    : request.analyzer === 'focus-motion'
      ? clip?.analysisStatus === 'ready' && Boolean(clip.analysis?.frames.length)
      : request.analyzer === 'faces'
        ? clip?.faceAnalysisStatus === 'ready' && Boolean(clip.analysis?.faceAnalysis)
        : false;
  return cached
    ? { state: 'warm', coldResetConfirmed: false, detail: 'Matching local analyzer output is visible in the current project state.' }
    : { state: 'unknown', coldResetConfirmed: false, detail: 'No observable matching local warm-cache artifact is available.' };
}

function observation(request: LocalBenchmarkRequest, mediaFileId: string, clipId?: string): LocalBenchmarkCacheObservation {
  if (request.cacheState === 'warm') return warmObservation(request, mediaFileId, clipId);
  return {
    state: 'unknown',
    coldResetConfirmed: false,
    detail: 'No registered verifier observed a complete local analyzer/model/artifact reset.',
  };
}

function unavailableExecution(request: LocalBenchmarkRequest, detail: string): LocalBenchmarkExecution {
  return { status: 'unavailable', pass: request.pass, baselineKind: request.baselineKind, detail };
}

async function observedExecution(
  request: LocalBenchmarkRequest,
  binding: Pick<LocalBenchmarkBinding, 'mediaFileId' | 'clipId'>,
  detail: string,
): Promise<LocalBenchmarkExecution> {
  if (!capabilityHooks?.observePass) {
    return unavailableExecution(request, 'No local pass-observability capability is registered.');
  }
  return {
    status: 'completed',
    pass: request.pass,
    baselineKind: request.baselineKind,
    detail,
    observability: await capabilityHooks.observePass(request, binding),
  };
}

function bindingFor(request: LocalBenchmarkRequest): LocalBenchmarkBinding | null {
  const mediaFile = selectedMatchingMedia(request);
  if (!mediaFile) return null;
  const clip = request.analyzer === 'cuts' ? undefined : matchingClip(mediaFile.id);
  if (request.analyzer !== 'cuts' && !clip) return null;
  const cancel = (): boolean => {
    if (request.analyzer === 'cuts') {
      cancelTimelineSceneCutAnalysis(mediaFile.id);
      return true;
    }
    if (request.analyzer === 'focus-motion' || request.analyzer === 'faces') {
      cancelAnalysis();
      return true;
    }
    return false;
  };
  return {
    mediaFileId: mediaFile.id,
    clipId: clip?.id,
    observeCache: async (current) => observation(current, mediaFile.id, clip?.id),
    verifyColdReset: async (current) => {
      if (!capabilityHooks?.verifyColdReset) {
        return observation(current, mediaFile.id, clip?.id);
      }
      return capabilityHooks.verifyColdReset(current, { mediaFileId: mediaFile.id, clipId: clip?.id });
    },
    cancel,
    runBaseline: async (current, signal) => {
      if (signal.aborted) return { ...unavailableExecution(current, 'Cancelled before local analyzer started.'), status: 'cancelled' };
      if (current.baselineKind !== 'standalone-cut') {
        return unavailableExecution(current, 'Proxy-piggyback baseline is not instrumented by the current browser adapter.');
      }
      await runTimelineSceneCutAnalysis(mediaFile.id, { force: false });
      if (signal.aborted) return { ...unavailableExecution(current, 'Cancelled while baseline completed.'), status: 'cancelled' };
      return observedExecution(current, { mediaFileId: mediaFile.id, clipId: clip?.id }, 'Standalone scene-cut baseline completed.');
    },
    runAnalysis: async (current, signal) => {
      if (signal.aborted) return { ...unavailableExecution(current, 'Cancelled before local analyzer started.'), status: 'cancelled' };
      if (current.analyzer === 'cuts') {
        await runTimelineSceneCutAnalysis(mediaFile.id, { force: false });
      } else if (current.analyzer === 'focus-motion') {
        await analyzeClip(clip!.id, { target: 'metrics', force: false });
      } else if (current.analyzer === 'faces') {
        await analyzeClip(clip!.id, { target: 'faces', force: false });
      } else {
        const levels = await audioAnalyzer.analyzeLevels(mediaFile.id);
        if (!levels) return unavailableExecution(current, 'The selected source could not be decoded by the local audio analyzer.');
      }
      if (signal.aborted) return { ...unavailableExecution(current, 'Cancelled while local analyzer was running.'), status: 'cancelled' };
      return observedExecution(current, { mediaFileId: mediaFile.id, clipId: clip?.id }, 'Local analysis pass completed.');
    },
  };
}

export function cancelAgentTimelineLocalBenchmark(): boolean {
  if (!activeCancel) return false;
  return activeCancel();
}

export function isAgentTimelineLocalBenchmarkTool(tool: string): boolean {
  return tool === LOCAL_BENCHMARK_TOOL;
}

/** Dev-bridge-only handler; it is intentionally absent from the normal AI tool registry. */
export async function runAgentTimelineLocalBenchmark(args: Record<string, unknown>): Promise<unknown> {
  if (args.cancel === true) return { cancelled: cancelAgentTimelineLocalBenchmark() };
  if (activeCancel) throw new Error('A local Agent Timeline benchmark pass is already running. Cancel it before starting another pass.');
  let cancel: (() => boolean) | null = null;
  try {
    return await runLocalBenchmarkPass({
      request: args,
      platform,
      deviceClass,
      resolveBinding: async (request) => {
        const binding = bindingFor(request);
        cancel = binding?.cancel ?? null;
        activeCancel = cancel;
        return binding;
      },
    });
  } finally {
    if (activeCancel === cancel) activeCancel = null;
  }
}
