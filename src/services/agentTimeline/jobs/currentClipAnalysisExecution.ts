import { getAgentTimelineProfileSettings } from '../profiles/analysisProfiles';
import { isCurrentSceneCutAnalysis } from '../../sceneCutDetection/sceneCutDetector';
import {
  cancelTimelineSceneCutAnalysis,
  findTimelineAnalysisClip,
  findTimelineAnalysisMediaFile,
  runTimelineSceneCutAnalysis,
} from '../../timeline/timelineRuntimeCoordinator';
import type { AgentTimelineJobGraphSnapshot } from '../../../types/agentTimeline/jobGraph';
import type { AgentTimelineProfile, AgentTimelineRange } from '../../../types/agentTimeline/manifest';
import {
  cancelAgentTimelineAnalysis,
  runAgentTimelineAnalysis,
  type AgentTimelineAnalysisOperation,
} from './analysisExecutionCoordinator';

export interface RunCurrentClipAnalysisOptions {
  clipId: string;
  /** Local visual runners only; provider runners retain their established semantics. */
  localVisual?: CurrentClipLocalVisualOptions;
  includeTranscript?: boolean;
  includeDescription?: boolean;
  onUpdate?: (snapshot: AgentTimelineJobGraphSnapshot) => void;
}

export interface CurrentClipLocalVisualOptions {
  profile: Extract<AgentTimelineProfile, 'quick' | 'balanced'>;
  sourceRange: AgentTimelineRange;
  includeFaces: boolean;
}

export function localVisualProfileIsSupported(
  profile: AgentTimelineProfile,
): profile is CurrentClipLocalVisualOptions['profile'] {
  return profile === 'quick' || profile === 'balanced';
}

function clipRunKey(clipId: string, localVisual: CurrentClipLocalVisualOptions): string {
  const { profile, sourceRange, includeFaces } = localVisual;
  return `current-clip:${clipId}:${profile}:${sourceRange.start.toFixed(3)}-${sourceRange.end.toFixed(3)}:${includeFaces ? 'faces' : 'metrics'}`;
}

function currentClip(clipId: string) {
  return findTimelineAnalysisClip(clipId);
}

function mediaFileIdFor(clipId: string): string | undefined {
  const clip = currentClip(clipId);
  return clip?.source?.mediaFileId ?? clip?.mediaFileId;
}

function isVideoClip(clipId: string): boolean {
  const clip = currentClip(clipId);
  if (clip?.source?.type) return clip.source.type === 'video';
  return Boolean(clip?.file && (
    clip.file.type.startsWith('video/')
    || /\.(mp4|webm|mov|avi|mkv|m4v|mxf)$/i.test(clip.file.name)
  ));
}

function failure(message: string): Error {
  return new Error(message);
}

function visualOperation(
  clipId: string,
  sourceKey: string,
  localVisual: CurrentClipLocalVisualOptions,
): AgentTimelineAnalysisOperation {
  const profile = getAgentTimelineProfileSettings(localVisual.profile);
  const sampleIntervalMs = 1000 / profile.metricSamplesPerSecond;
  const faceSampleIntervalMs = 1000 / profile.faceSamplesPerSecond;
  return {
    id: 'visual',
    channel: localVisual.includeFaces ? 'quality,camera-motion,people' : 'quality,camera-motion',
    resourceLocks: [
      `source-decode:${sourceKey}`,
      'legacy-clip-analyzer',
      ...(localVisual.includeFaces ? ['face-model'] : []),
    ],
    isCached() {
      // Legacy clip status has no source identity, source-range coverage,
      // profile/cadence, or analyzer-version provenance. Treating `ready` as
      // a cache hit could therefore reuse a different trim or a coarser pass.
      // clipAnalyzer owns its project-cache compatibility check, so this graph
      // boundary must fail closed until a compatible Agent Timeline manifest is
      // available here.
      return false;
    },
    async run() {
      const { analyzeClip } = await import('../../clipAnalyzer');
      await analyzeClip(clipId, {
        target: localVisual.includeFaces ? 'all' : 'metrics',
        force: false,
        sourceRange: localVisual.sourceRange,
        sampleIntervalMs,
        faceSampleIntervalMs,
      });
      const clip = currentClip(clipId);
      if (clip?.analysisStatus === 'error'
        || (localVisual.includeFaces && clip?.faceAnalysisStatus === 'error')) {
        throw failure(clip.faceAnalysisMessage ?? 'Visual analysis failed.');
      }
    },
    cancel() {
      void import('../../clipAnalyzer').then(({ cancelAnalysis }) => cancelAnalysis());
    },
  };
}

function cutOperation(mediaFileId: string, sourceKey: string): AgentTimelineAnalysisOperation {
  return {
    id: 'cuts',
    channel: 'cuts',
    resourceLocks: [`source-decode:${sourceKey}`, `scene-cut-analyzer:${sourceKey}`],
    isCached() {
      const media = findTimelineAnalysisMediaFile(mediaFileId);
      return media?.sceneCutStatus === 'ready'
        && isCurrentSceneCutAnalysis(media.sceneCutAnalysis, media.file);
    },
    async run() {
      await runTimelineSceneCutAnalysis(mediaFileId, { force: false });
      const media = findTimelineAnalysisMediaFile(mediaFileId);
      if (media?.sceneCutStatus === 'error') throw failure('Scene-cut analysis failed.');
    },
    cancel() {
      cancelTimelineSceneCutAnalysis(mediaFileId);
    },
  };
}

function transcriptOperation(clipId: string, sourceKey: string): AgentTimelineAnalysisOperation {
  return {
    id: 'transcript',
    channel: 'speech',
    resourceLocks: [`source-audio:${sourceKey}`, 'transcription-provider'],
    // Transcript status does not retain provider/model/range provenance at this
    // call boundary. Re-run so the provider can apply its own compatible cache
    // policy instead of falsely claiming this graph has a matching result.
    isCached: () => false,
    async run() {
      const { transcribeClip } = await import('../../clipTranscriber');
      await transcribeClip(clipId, 'auto');
      const clip = currentClip(clipId);
      if (clip?.transcriptStatus === 'error') {
        throw failure(clip.transcriptMessage ?? 'Transcription failed.');
      }
    },
    cancel() {
      void import('../../clipTranscriber').then(({ cancelTranscription }) => (
        cancelTranscription(clipId)
      ));
    },
  };
}

function descriptionOperation(clipId: string, sourceKey: string): AgentTimelineAnalysisOperation {
  return {
    id: 'descriptions',
    channel: 'scenes',
    resourceLocks: [`source-read:${sourceKey}`, 'scene-description-provider'],
    // Scene-description status likewise has no source identity, coverage, or
    // provider/model metadata. A bare ready flag is never a safe cache hit.
    isCached: () => false,
    async run() {
      const { describeClip } = await import('../../sceneDescriber');
      await describeClip(clipId);
      const clip = currentClip(clipId);
      if (clip?.sceneDescriptionStatus === 'error') {
        throw failure(clip.sceneDescriptionMessage ?? 'Scene description failed.');
      }
    },
    cancel() {
      void import('../../sceneDescriber').then(({ cancelDescription }) => cancelDescription());
    },
  };
}

/**
 * Bridges the existing analyzers into the shared graph. Only operations with
 * proven compatibility are reused here; source decoders are serialized while
 * audio/provider work can proceed independently.
 */
export function runCurrentClipAnalysis(
  options: RunCurrentClipAnalysisOptions,
): Promise<AgentTimelineJobGraphSnapshot> {
  const clip = currentClip(options.clipId);
  if (!clip) throw new Error(`Clip not found: ${options.clipId}`);
  const mediaFileId = mediaFileIdFor(options.clipId);
  const sourceKey = mediaFileId ?? options.clipId;
  const video = isVideoClip(options.clipId);
  const fallbackRange = {
    start: clip.inPoint ?? 0,
    end: clip.outPoint ?? clip.duration,
  };
  const localVisual = options.localVisual ?? {
    profile: 'balanced' as const,
    sourceRange: fallbackRange,
    includeFaces: true,
  };
  if (!localVisualProfileIsSupported(localVisual.profile)) {
    throw new Error(`Analysis profile ${localVisual.profile} is blocked until matching real-media benchmark evidence exists.`);
  }
  if (!Number.isFinite(localVisual.sourceRange.start)
    || !Number.isFinite(localVisual.sourceRange.end)
    || localVisual.sourceRange.end <= localVisual.sourceRange.start) {
    throw new RangeError('Local visual analysis requires a finite source range with positive duration.');
  }
  const operations: AgentTimelineAnalysisOperation[] = [];
  if (video) {
    operations.push(visualOperation(options.clipId, sourceKey, localVisual));
    if (mediaFileId) operations.push(cutOperation(mediaFileId, sourceKey));
    // Descriptions can call a provider and are intentionally opt-in. Analyze
    // All covers local visual, cuts, and (unless disabled) transcript work;
    // callers that explicitly want scene descriptions pass `true`.
    if (options.includeDescription === true) {
      operations.push(descriptionOperation(options.clipId, sourceKey));
    }
  }
  if (options.includeTranscript !== false) {
    operations.push(transcriptOperation(options.clipId, sourceKey));
  }
  return runAgentTimelineAnalysis({
    runKey: clipRunKey(options.clipId, localVisual),
    operations,
    onUpdate: options.onUpdate,
  });
}

export function cancelCurrentClipAnalysis(
  clipId: string,
  localVisual?: CurrentClipLocalVisualOptions,
): boolean {
  const clip = currentClip(clipId);
  if (!clip) return false;
  const visual = localVisual ?? {
    profile: 'balanced' as const,
    sourceRange: { start: clip.inPoint ?? 0, end: clip.outPoint ?? clip.duration },
    includeFaces: true,
  };
  return cancelAgentTimelineAnalysis(clipRunKey(clipId, visual));
}
