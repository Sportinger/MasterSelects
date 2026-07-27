import { Logger } from '../../logger';
import type { AnalysisService } from '../domains/AnalysisService';
import type { CacheService } from '../domains/CacheService';
import {
  getAudioProxyFileName,
  type ProxyFrameScanProgressCallback,
  type ProxyFrameWriter,
  type ProxyStorageService,
} from '../domains/ProxyStorageService';
import type { TranscriptService } from '../domains/TranscriptService';
import {
  getProxyAudioNative,
  hasProxyAudioNative,
  saveProxyAudioNative,
} from './nativeBackend';

const log = Logger.create('ProjectFileService');

type ProjectFileStorageBackend = 'fsa' | 'native';

export interface ArtifactStorageContext {
  activeBackend: ProjectFileStorageBackend;
  getProjectHandle: () => FileSystemDirectoryHandle | null;
  getNativeProjectPath: () => string | null;
  cacheService: CacheService;
  proxyStorageService: ProxyStorageService;
  analysisService: AnalysisService;
  transcriptService: TranscriptService;
  deleteFile: (subFolder: string, fileName: string) => Promise<boolean>;
  deleteEntry: (subFolder: string, entryName: string, options?: { recursive?: boolean }) => Promise<boolean>;
}

export async function saveThumbnail(context: ArtifactStorageContext, fileHash: string, blob: Blob): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.saveThumbnail(handle, fileHash, blob);
}

export async function getThumbnail(context: ArtifactStorageContext, fileHash: string): Promise<Blob | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.cacheService.getThumbnail(handle, fileHash);
}

export async function hasThumbnail(context: ArtifactStorageContext, fileHash: string): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.hasThumbnail(handle, fileHash);
}

export async function deleteThumbnail(context: ArtifactStorageContext, fileHash: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return context.deleteFile('CACHE_THUMBNAILS', `${fileHash}.jpg`);
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.deleteThumbnail(handle, fileHash);
}

export async function saveGaussianSplatRuntime(
  context: ArtifactStorageContext,
  fileHash: string,
  variant: string,
  blob: Blob,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.saveGaussianSplatRuntime(handle, fileHash, variant, blob);
}

export async function getGaussianSplatRuntime(
  context: ArtifactStorageContext,
  fileHash: string,
  variant: string,
): Promise<File | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.cacheService.getGaussianSplatRuntime(handle, fileHash, variant);
}

export async function hasGaussianSplatRuntime(
  context: ArtifactStorageContext,
  fileHash: string,
  variant: string,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.hasGaussianSplatRuntime(handle, fileHash, variant);
}

export async function saveWaveform(
  context: ArtifactStorageContext,
  mediaId: string,
  waveformData: Float32Array,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.saveWaveform(handle, mediaId, waveformData);
}

export async function getWaveform(context: ArtifactStorageContext, mediaId: string): Promise<Float32Array | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.cacheService.getWaveform(handle, mediaId);
}

export async function deleteWaveform(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return context.deleteFile('CACHE_WAVEFORMS', `${mediaId}.waveform`);
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.cacheService.deleteWaveform(handle, mediaId);
}

export async function saveProxyFrame(
  context: ArtifactStorageContext,
  mediaId: string,
  frameIndex: number,
  blob: Blob,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) {
    log.error('No project handle for proxy save!');
    return false;
  }
  return context.proxyStorageService.saveProxyFrame(handle, mediaId, frameIndex, blob);
}

export async function createProxyFrameWriter(
  context: ArtifactStorageContext,
  mediaId: string,
): Promise<ProxyFrameWriter | null> {
  const handle = context.getProjectHandle();
  if (!handle) {
    log.error('No project handle for proxy writer!');
    return null;
  }
  return context.proxyStorageService.createProxyFrameWriter(handle, mediaId);
}

export async function getProxyFrame(
  context: ArtifactStorageContext,
  mediaId: string,
  frameIndex: number,
): Promise<Blob | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.proxyStorageService.getProxyFrame(handle, mediaId, frameIndex);
}

export async function hasProxy(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.proxyStorageService.hasProxy(handle, mediaId);
}

export async function getProxyFrameCount(context: ArtifactStorageContext, mediaId: string): Promise<number> {
  const handle = context.getProjectHandle();
  if (!handle) return 0;
  return context.proxyStorageService.getProxyFrameCount(handle, mediaId);
}

export async function getProxyFrameIndices(
  context: ArtifactStorageContext,
  mediaId: string,
  onProgress?: ProxyFrameScanProgressCallback,
): Promise<Set<number>> {
  const handle = context.getProjectHandle();
  if (!handle) return new Set();
  return context.proxyStorageService.getProxyFrameIndices(handle, mediaId, onProgress);
}

export async function saveProxyVideo(
  context: ArtifactStorageContext,
  mediaId: string,
  blob: Blob,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) {
    log.error('No project handle for proxy video save!');
    return false;
  }
  return context.proxyStorageService.saveProxyVideo(handle, mediaId, blob);
}

export async function getProxyVideo(context: ArtifactStorageContext, mediaId: string): Promise<File | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.proxyStorageService.getProxyVideo(handle, mediaId);
}

export async function hasProxyVideo(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.proxyStorageService.hasProxyVideo(handle, mediaId);
}

export async function saveProxyAudio(
  context: ArtifactStorageContext,
  mediaId: string,
  blob: Blob,
): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return saveProxyAudioNative(context.getNativeProjectPath(), mediaId, blob);
  }

  const handle = context.getProjectHandle();
  if (!handle) {
    log.error('No project handle for audio proxy save!');
    return false;
  }
  return context.proxyStorageService.saveProxyAudio(handle, mediaId, blob);
}

export async function getProxyAudio(context: ArtifactStorageContext, mediaId: string): Promise<File | null> {
  if (context.activeBackend === 'native') {
    return getProxyAudioNative(context.getNativeProjectPath(), mediaId);
  }

  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.proxyStorageService.getProxyAudio(handle, mediaId);
}

export async function hasProxyAudio(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return hasProxyAudioNative(context.getNativeProjectPath(), mediaId);
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.proxyStorageService.hasProxyAudio(handle, mediaId);
}

export async function deleteProxy(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    const deletedVideoProxy = await context.deleteEntry('PROXY', mediaId, { recursive: true });
    const deletedAudioProxy = await context.deleteFile('AUDIO_PROXIES', getAudioProxyFileName(mediaId));
    return deletedVideoProxy || deletedAudioProxy;
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.proxyStorageService.deleteProxy(handle, mediaId);
}

export async function saveAnalysis(
  context: ArtifactStorageContext,
  mediaId: string,
  inPoint: number,
  outPoint: number,
  frames: unknown[],
  sampleInterval: number,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.analysisService.saveAnalysis(handle, mediaId, inPoint, outPoint, frames, sampleInterval);
}

export async function getAnalysis(
  context: ArtifactStorageContext,
  mediaId: string,
  inPoint: number,
  outPoint: number,
): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.analysisService.getAnalysis(handle, mediaId, inPoint, outPoint);
}

export async function hasAnalysis(
  context: ArtifactStorageContext,
  mediaId: string,
  inPoint: number,
  outPoint: number,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.analysisService.hasAnalysis(handle, mediaId, inPoint, outPoint);
}

export async function getAnalysisRanges(context: ArtifactStorageContext, mediaId: string): Promise<string[]> {
  const handle = context.getProjectHandle();
  if (!handle) return [];
  return context.analysisService.getAnalysisRanges(handle, mediaId);
}

export async function getAllAnalysisMerged(
  context: ArtifactStorageContext,
  mediaId: string,
): Promise<{ frames: unknown[]; sampleInterval: number } | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.analysisService.getAllAnalysisMerged(handle, mediaId);
}

export async function deleteAnalysis(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return context.deleteFile('ANALYSIS', `${mediaId}.json`);
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.analysisService.deleteAnalysis(handle, mediaId);
}

export async function deleteAnalysisRange(
  context: ArtifactStorageContext,
  mediaId: string,
  inPoint: number,
  outPoint: number,
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.analysisService.deleteAnalysisRange(handle, mediaId, inPoint, outPoint);
}

export async function saveTranscript(
  context: ArtifactStorageContext,
  mediaId: string,
  transcript: unknown,
  transcribedRanges?: [number, number][],
): Promise<boolean> {
  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.transcriptService.saveTranscript(handle, mediaId, transcript, transcribedRanges);
}

export async function getTranscript(
  context: ArtifactStorageContext,
  mediaId: string,
): Promise<{ words: unknown[]; transcribedRanges?: [number, number][] } | null> {
  const handle = context.getProjectHandle();
  if (!handle) return null;
  return context.transcriptService.getTranscript(handle, mediaId);
}

export async function getTranscribedRanges(
  context: ArtifactStorageContext,
  mediaId: string,
): Promise<[number, number][]> {
  const handle = context.getProjectHandle();
  if (!handle) return [];
  return context.transcriptService.getTranscribedRanges(handle, mediaId);
}

export async function deleteTranscript(context: ArtifactStorageContext, mediaId: string): Promise<boolean> {
  if (context.activeBackend === 'native') {
    return context.deleteFile('TRANSCRIPTS', `${mediaId}.json`);
  }

  const handle = context.getProjectHandle();
  if (!handle) return false;
  return context.transcriptService.deleteTranscript(handle, mediaId);
}
