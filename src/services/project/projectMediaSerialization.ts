import type { MediaFile, MediaFolder } from '../../stores/mediaStore';
import { isProxyFrameCountComplete } from '../../stores/mediaStore/helpers/proxyCompleteness';
import type { ProjectClip, ProjectFolder, ProjectMediaFile } from '../projectFileService';

function shouldPersistMediaWaveform(file: MediaFile): boolean {
  return !file.audioAnalysisRefs?.waveformPyramidId;
}

export function serializeModelSequence(sequence: MediaFile['modelSequence'] | ProjectClip['modelSequence']) {
  return sequence
    ? {
        ...sequence,
        frames: sequence.frames.map((frame) => ({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath,
        })),
      }
    : undefined;
}

export function serializeGaussianSplatSequence(
  sequence: MediaFile['gaussianSplatSequence'] | ProjectClip['gaussianSplatSequence'],
) {
  return sequence
    ? {
        ...sequence,
        frames: sequence.frames.map((frame) => ({
          name: frame.name,
          projectPath: frame.projectPath,
          sourcePath: frame.sourcePath,
          absolutePath: frame.absolutePath,
          splatCount: frame.splatCount,
          fileSize: frame.fileSize,
          container: frame.container,
          codec: frame.codec,
        })),
      }
    : undefined;
}

/** Convert mediaStore files to ProjectMediaFile format. */
export function convertMediaFiles(files: MediaFile[]): ProjectMediaFile[] {
  return files.map((file) => {
    const hasProxy =
      file.proxyStatus === 'ready' &&
      file.proxyFormat === 'jpeg-sequence' &&
      isProxyFrameCountComplete(file.proxyFrameCount, file.duration, file.proxyFps ?? file.fps);

    return {
      id: file.id,
      name: file.name,
      type: file.type as 'video' | 'audio' | 'image' | 'model' | 'gaussian-splat' | 'lottie' | 'rive',
      sourcePath: file.liveInput ? `live:${file.id}` : file.filePath || file.name,
      projectPath: file.projectPath,
      fileHash: file.fileHash,
      duration: file.duration,
      width: file.width,
      height: file.height,
      frameRate: file.fps,
      codec: file.codec ?? file.gaussianSplatSequence?.codec,
      audioCodec: file.audioCodec,
      container: file.container ?? (file.gaussianSplatSequence?.container ? `${file.gaussianSplatSequence.container} Seq` : undefined),
      bitrate: file.bitrate,
      fileSize: file.fileSize ?? file.gaussianSplatSequence?.totalFileSize,
      hasAudio: file.hasAudio,
      splatCount: file.splatCount ?? file.gaussianSplatSequence?.frames[0]?.splatCount,
      totalSplatCount: file.totalSplatCount ?? file.gaussianSplatSequence?.totalSplatCount,
      splatFrameCount: file.splatFrameCount ?? file.gaussianSplatSequence?.frameCount,
      hasProxy,
      proxyFormat: hasProxy ? file.proxyFormat : undefined,
      hasAudioProxy: file.hasProxyAudio === true || file.audioProxyStatus === 'ready',
      audioProxyStorageKey: file.audioProxyStorageKey || file.fileHash || file.id,
      audioAnalysisRefs: file.audioAnalysisRefs ? structuredClone(file.audioAnalysisRefs) : undefined,
      stemInfo: file.stemInfo ? structuredClone(file.stemInfo) : undefined,
      waveform: shouldPersistMediaWaveform(file) && file.waveformStatus === 'ready' && file.waveform
        ? [...file.waveform]
        : undefined,
      waveformChannels: shouldPersistMediaWaveform(file) && file.waveformStatus === 'ready'
        ? file.waveformChannels?.map(channel => [...channel])
        : undefined,
      vectorAnimation: file.vectorAnimation,
      modelSequence: serializeModelSequence(file.modelSequence),
      gaussianSplatSequence: serializeGaussianSplatSequence(file.gaussianSplatSequence),
      folderId: file.parentId,
      labelColor: file.labelColor && file.labelColor !== 'none' ? file.labelColor : undefined,
      importedAt: new Date(file.createdAt).toISOString(),
      liveInput: file.liveInput ? structuredClone(file.liveInput) : undefined,
    };
  });
}

/** Convert mediaStore folders to ProjectFolder format. */
export function convertFolders(folders: MediaFolder[]): ProjectFolder[] {
  return folders.map((folder) => ({
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    labelColor: folder.labelColor && folder.labelColor !== 'none' ? folder.labelColor : undefined,
  }));
}
