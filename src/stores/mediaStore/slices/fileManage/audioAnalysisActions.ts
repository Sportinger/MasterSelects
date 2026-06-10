import type { MediaSliceCreator } from '../../types';
import { audioExtractor } from '../../../../engine/audio/AudioExtractor';
import { createFileAudioSourceFingerprint } from '../../../../services/audio/ProcessedWaveformPyramidService';
import { SpectrogramTileSetGenerator } from '../../../../services/audio/SpectrogramTileSetGenerator';
import { createCurrentAudioArtifactStore } from '../../../../services/audio/timelineWaveformPyramidCache';
import {
  primeTimelineSpectrogramTileSetCache,
  readTimelineSpectrogramTileSet,
} from '../../../../services/audio/timelineSpectrogramCache';
import { startMediaFileWaveformGeneration } from '../../helpers/mediaWaveformHelpers';
import type { FileManageActions } from '../fileManageSlice';
import { fileManageLog as log } from './log';
import {
  mediaFileCanHaveAudio,
  resolveMediaFileSourceFile,
  updateMediaFileWaveform,
} from './sourceResolution';

const activeMediaSpectrogramJobs = new Map<string, Promise<void>>();

export const createMediaAudioAnalysisActions: MediaSliceCreator<Pick<
  FileManageActions,
  'generateMediaWaveform' | 'generateMediaSpectrogram'
>> = (set, get) => ({
  generateMediaWaveform: async (id: string, options: { force?: boolean } = {}) => {
    const mediaFile = get().files.find((file) => file.id === id);
    if (!mediaFile || !mediaFileCanHaveAudio(mediaFile)) return;

    const sourceFile = await resolveMediaFileSourceFile(mediaFile);
    if (!sourceFile) {
      updateMediaFileWaveform(set, id, {
        waveformStatus: 'error',
        waveformProgress: 0,
      });
      return;
    }

    startMediaFileWaveformGeneration(
      {
        ...mediaFile,
        file: sourceFile,
      },
      (mediaFileId, updates) => updateMediaFileWaveform(set, mediaFileId, updates),
      (mediaFileId) => get().files.find((file) => file.id === mediaFileId),
      options,
    );
  },

  generateMediaSpectrogram: async (id: string, options: { force?: boolean } = {}) => {
    const mediaFile = get().files.find((file) => file.id === id);
    if (!mediaFile || !mediaFileCanHaveAudio(mediaFile)) return;

    const existingSpectrogramId = mediaFile.audioAnalysisRefs?.spectrogramTileSetIds?.[0];
    if (!options.force && existingSpectrogramId) return;

    const existingJob = activeMediaSpectrogramJobs.get(id);
    if (existingJob) {
      await existingJob;
      return;
    }

    const previousWaveformStatus = mediaFile.waveformStatus;
    const previousWaveformProgress = mediaFile.waveformProgress;

    const job = (async () => {
      try {
        updateMediaFileWaveform(set, id, {
          waveformStatus: 'generating',
          waveformProgress: 1,
        });

        const sourceFile = await resolveMediaFileSourceFile(mediaFile);
        if (!sourceFile) {
          updateMediaFileWaveform(set, id, {
            waveformStatus: 'error',
            waveformProgress: 0,
          });
          return;
        }

        const sourceFingerprint = await createFileAudioSourceFingerprint(sourceFile);
        updateMediaFileWaveform(set, id, { waveformProgress: 12 });

        const sourceBuffer = await audioExtractor.extractAudio(sourceFile, id);
        updateMediaFileWaveform(set, id, { waveformProgress: 35 });

        const store = createCurrentAudioArtifactStore();
        const generator = new SpectrogramTileSetGenerator({ artifactStore: store });
        const generated = await generator.generate({
          mediaFileId: id,
          sourceFingerprint,
          buffer: sourceBuffer,
          decoderId: 'masterselects.audio-extractor',
          decoderVersion: '1.0.0',
          metadata: {
            analysisKind: 'spectrogram-tiles',
            mediaFileName: mediaFile.name,
          },
        }, {
          onProgress: (progress) => {
            updateMediaFileWaveform(set, id, {
              waveformProgress: Math.min(99, Math.max(35, Math.round(35 + progress.percent * 0.64))),
            });
          },
        });

        const tileSet = await readTimelineSpectrogramTileSet(generated.manifest, store);
        primeTimelineSpectrogramTileSetCache([
          generated.artifact.id,
          generated.artifact.manifestRef.artifactId,
          generated.analysisRef.artifactId,
        ], tileSet);

        const refId = generated.artifact.manifestRef.artifactId;
        set((state) => ({
          files: state.files.map((file) => {
            if (file.id !== id) return file;
            return {
              ...file,
              audioAnalysisRefs: {
                ...(file.audioAnalysisRefs ?? {}),
                spectrogramTileSetIds: [refId],
              },
              waveformStatus: file.waveform?.length ? 'ready' : (previousWaveformStatus ?? 'idle'),
              waveformProgress: file.waveform?.length ? 100 : (previousWaveformProgress ?? 0),
            };
          }),
        }));
      } catch (error) {
        updateMediaFileWaveform(set, id, {
          waveformStatus: 'error',
          waveformProgress: 0,
        });
        log.warn('Failed to generate media spectrogram', {
          id,
          name: mediaFile.name,
          error,
        });
      }
    })().finally(() => {
      activeMediaSpectrogramJobs.delete(id);
    });

    activeMediaSpectrogramJobs.set(id, job);
    await job;
  },
});
