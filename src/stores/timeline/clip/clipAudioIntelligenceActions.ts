import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { AudioIntelligenceGenerator } from '../../../services/audio/intelligence/AudioIntelligenceGenerator';
import { getAudioIntelligenceRuntime } from '../../../services/audio/intelligence/AudioIntelligenceRuntime';
import type { AudioIntelligenceFeature } from '../../../services/audio/intelligence/audioIntelligenceTypes';
import { computeTranscriptWordsHash } from '../../../services/audio/transcriptTimingManifest';
import { createCurrentAudioArtifactStore } from '../../../services/audio/timelineWaveformPyramidCache';
import { getAgentTimelineProfileSettings } from '../../../services/agentTimeline/profiles/analysisProfiles';
import { resolveClipTranscriptWords } from '../../../services/transcription/clipTranscriptResolver';
import { isPreparedClipAudioAnalysisInputStale } from '../../../services/audio/ClipAudioAnalysisOrchestrator';
import { clipAudioAnalysisJobService } from '../../../services/audio/ClipAudioAnalysisJobService';
import type { GenerateClipAudioAnalysisOptions } from '../types';
import type { ClipActionContext } from './clipActionContext';
import {
  clearAudioAnalysisJobUpdate,
  createAudioAnalysisJobUpdate,
  isAudioAnalysisCancellation,
  updateAudioAnalysisJobProgress,
} from './clipAudioAnalysisShared';
import {
  getPreparedProgress,
  prepareAnalysisInput,
} from './clipPreparedAudioAnalysisCore';

const log = Logger.create('ClipAudioIntelligence');

const AUDIO_INTELLIGENCE_FEATURES: ReadonlySet<AudioIntelligenceFeature> = new Set([
  'vad',
  'alignment',
  'speech-markers',
  'prosody',
  'room-tone',
]);

type AudioIntelligenceActionOptions = GenerateClipAudioAnalysisOptions & {
  features?: ReadonlySet<AudioIntelligenceFeature>;
};

function storedLanguage(): string | undefined {
  const language = globalThis.localStorage?.getItem('transcriptLanguage');
  return language && language !== 'auto' ? language : undefined;
}

function analysisHopSeconds(): number {
  const stored = globalThis.localStorage?.getItem('analysisProfile');
  const profile = stored === 'quick' || stored === 'deep' || stored === 'balanced'
    ? stored
    : 'balanced';
  return Math.min(getAgentTimelineProfileSettings(profile).audioHopSeconds ?? 0.05, 0.05);
}

function hasRequestedArtifacts(
  refs: NonNullable<NonNullable<ReturnType<ClipActionContext['get']>['clips'][number]['audioState']>['sourceAnalysisRefs']> | undefined,
  features: ReadonlySet<AudioIntelligenceFeature>,
): boolean {
  return [...features].every((feature) => {
    if (feature === 'vad') return Boolean(refs?.voiceActivityId);
    if (feature === 'alignment') return Boolean(refs?.transcriptTimingId);
    if (feature === 'speech-markers') return Boolean(refs?.speechMarkersId);
    if (feature === 'prosody') return Boolean(refs?.prosodyContourId);
    return Boolean(refs?.roomToneProfileId);
  });
}

export async function generateAudioIntelligenceForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  const requestedFeatures = (options as AudioIntelligenceActionOptions).features
    ?? AUDIO_INTELLIGENCE_FEATURES;
  // Audio intelligence always analyzes the source audio (needsProcessed
  // false), so the skip check only consults sourceAnalysisRefs.
  const clip = get().clips.find(c => c.id === clipId);
  if (!clip || clip.waveformGenerating) return;
  if (!options.force && hasRequestedArtifacts(clip.audioState?.sourceAnalysisRefs, requestedFeatures)) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'audio-intelligence',
    label: 'Audio Intelligence',
    artifactKinds: [...requestedFeatures].map((feature) => {
      if (feature === 'vad') return 'voice-activity';
      if (feature === 'alignment') return 'transcript-timing';
      if (feature === 'speech-markers') return 'speech-markers';
      if (feature === 'prosody') return 'prosody-contour';
      return 'room-tone-profile';
    }),
    processed: false,
  })) });

  try {
    await clipAudioAnalysisJobService.run({ clipId, kind: 'audio-intelligence' }, async ({ signal }) => {
      const prepared = await prepareAnalysisInput(context, clipId, false, signal, 'No audio source found for audio intelligence analysis');
      if (!prepared) return;

      const store = createCurrentAudioArtifactStore();
      const generator = new AudioIntelligenceGenerator({
        artifactStore: store,
        runtime: getAudioIntelligenceRuntime(),
      });
      const currentSourceClip = get().clips.find(c => c.id === clipId);
      const transcriptWords = currentSourceClip
        ? resolveClipTranscriptWords(currentSourceClip)
        : undefined;
      const transcript = transcriptWords ? {
        words: transcriptWords,
        hash: await computeTranscriptWordsHash(transcriptWords),
        language: storedLanguage(),
        wordSource: transcriptWords.some(word => word.sourceProvider)
          ? 'provider' as const
          : 'synthetic' as const,
      } : undefined;
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        features: requestedFeatures,
        transcript,
        profile: { hopSeconds: analysisHopSeconds() },
        clipAudioStateHash: prepared.clipAudioStateHash,
        decoderId: prepared.decoderId,
        decoderVersion: prepared.decoderVersion,
        metadata: prepared.metadata,
      }, {
        signal,
        onProgress: (progress) => set({ clips: updateAudioAnalysisJobProgress(get().clips, clipId, getPreparedProgress(progress.progress * 100, false), progress.stage === 'storing' ? 'storing' : 'analyzing', progress.message) }),
      });

      const currentClip = get().clips.find(c => c.id === clipId);
      if (!currentClip || isPreparedClipAudioAnalysisInputStale(prepared, currentClip)) {
        set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
        return;
      }
      const voiceActivityId = generated.artifacts.voiceActivity?.manifestRef.artifactId;
      const transcriptTimingId = generated.artifacts.transcriptTiming?.manifestRef.artifactId;
      const speechMarkersId = generated.artifacts.speechMarkers?.manifestRef.artifactId;
      const prosodyContourId = generated.artifacts.prosodyContour?.manifestRef.artifactId;
      const roomToneProfileId = generated.artifacts.roomToneProfile?.manifestRef.artifactId;
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          sourceAnalysisRefs: {
            ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
            ...(voiceActivityId ? { voiceActivityId } : {}),
            ...(transcriptTimingId ? { transcriptTimingId } : {}),
            ...(speechMarkersId ? { speechMarkersId } : {}),
            ...(prosodyContourId ? { prosodyContourId } : {}),
            ...(roomToneProfileId ? { roomToneProfileId } : {}),
          },
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });

      // Always merge from the freshest persisted artifacts: on re-runs the
      // generator skips fresh stages, so the result may omit artifacts whose
      // timings/emphasis still need applying. The apply functions are
      // idempotent (already-applied/stale guards), so this is cheap.
      // Dynamic import: applyAlignedTimings reads the timeline store, a
      // static import from inside the store graph would be circular.
      const { applyAlignedTimingsForMedia, applyWordEmphasisForMedia } =
        await import('../../../services/transcription/applyAlignedTimings');
      const appliedTimings = await applyAlignedTimingsForMedia(prepared.mediaFileId, store);
      if (appliedTimings && !appliedTimings.skipped) {
        log.info(`Merged aligned timings into ${appliedTimings.applied} transcript words`);
      } else if (appliedTimings?.skipped !== 'already-applied') {
        log.warn('Aligned timings not merged into transcript', appliedTimings ?? 'no artifact');
      }
      const appliedEmphasis = await applyWordEmphasisForMedia(prepared.mediaFileId, store);
      if (appliedEmphasis && !appliedEmphasis.skipped) {
        log.info(`Merged emphasis into ${appliedEmphasis.applied} transcript words`);
      } else if (appliedEmphasis?.skipped !== 'already-applied') {
        log.warn('Word emphasis not merged into transcript', appliedEmphasis ?? 'no artifact');
      }
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Audio intelligence analysis failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}
