import { Logger } from '../../../services/logger';
import { updateClipById } from '../helpers/clipStateHelpers';
import { AudioIntelligenceGenerator } from '../../../services/audio/intelligence/AudioIntelligenceGenerator';
import { getAudioIntelligenceRuntime } from '../../../services/audio/intelligence/AudioIntelligenceRuntime';
import type { AudioIntelligenceFeature } from '../../../services/audio/intelligence/audioIntelligenceTypes';
import { createCurrentAudioArtifactStore } from '../../../services/audio/timelineWaveformPyramidCache';
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

const AUDIO_INTELLIGENCE_FEATURES: ReadonlySet<AudioIntelligenceFeature> = new Set(['vad']);

export async function generateAudioIntelligenceForClipAction(
  context: ClipActionContext,
  clipId: string,
  options: GenerateClipAudioAnalysisOptions = {},
): Promise<void> {
  const { get, set } = context;
  // Audio intelligence always analyzes the source audio (needsProcessed
  // false), so the skip check only consults sourceAnalysisRefs.
  const clip = get().clips.find(c => c.id === clipId);
  if (!clip || clip.waveformGenerating) return;
  if (!options.force && clip.audioState?.sourceAnalysisRefs?.voiceActivityId) return;

  set({ clips: updateClipById(get().clips, clipId, createAudioAnalysisJobUpdate({
    kind: 'audio-intelligence',
    label: 'Audio Intelligence',
    artifactKinds: ['voice-activity'],
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
      const generated = await generator.generate({
        mediaFileId: prepared.mediaFileId,
        sourceFingerprint: prepared.sourceFingerprint,
        buffer: prepared.analysisBuffer,
        features: AUDIO_INTELLIGENCE_FEATURES,
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
      set({ clips: updateClipById(get().clips, clipId, {
        audioState: {
          ...(currentClip.audioState ?? {}),
          sourceAnalysisRefs: {
            ...(currentClip.audioState?.sourceAnalysisRefs ?? {}),
            ...(voiceActivityId ? { voiceActivityId } : {}),
          },
        },
        ...clearAudioAnalysisJobUpdate(),
        waveformProgress: 100,
      }) });
    });
  } catch (e) {
    log[isAudioAnalysisCancellation(e) ? 'debug' : 'error']('Audio intelligence analysis failed', e);
    set({ clips: updateClipById(get().clips, clipId, clearAudioAnalysisJobUpdate()) });
  }
}
