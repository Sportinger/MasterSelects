import { create } from 'zustand';
import { NativeHelperClient, type VideoInfo } from '../services/nativeHelper';
import { projectFileService } from '../services/projectFileService';
import { downloadVideo, isDownloadAvailable, type DownloadProgress } from '../services/youtubeDownloader';
import { useMediaStore, type MediaFile } from './mediaStore';
import { requireMediaFileImportResult } from './mediaStore/helpers/importResult';
import { useYouTubeStore } from './youtubeStore';
import type { ExternalMediaOrigin, ExternalMediaProvider } from '../types/mediaMetadata';
import {
  createDownloadKey,
  detectDownloadPlatform,
  DOWNLOAD_PLATFORM_LABELS,
  extractVideoId,
  fetchYouTubePreviewMetadata,
  type VideoUrlPreviewMetadata,
} from '../services/mediaDiscovery/videoUrlDownloads';

export { detectDownloadPlatform, extractVideoId, parseDownloadUrls } from '../services/mediaDiscovery/videoUrlDownloads';

export type MediaDownloadJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface MediaDownloadJob {
  id: string;
  url: string;
  downloadKey: string;
  formatId?: string;
  formatLabel?: string;
  /** True when title/thumbnail/channel/duration were supplied at enqueue time. */
  metadataResolved?: boolean;
  title: string;
  thumbnail: string;
  channel: string;
  platform: string;
  durationSeconds: number;
  status: MediaDownloadJobStatus;
  progress?: number;
  speed?: string;
  error?: string;
  mediaFileId?: string;
  fileName?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface MediaDownloadRequest {
  url: string;
  formatId?: string;
  formatLabel?: string;
  /** Metadata the caller already resolved (e.g. the paste dialog), skipping a second lookup. */
  metadata?: ResolvedDownloadMetadata;
}

export type ResolvedDownloadMetadata = VideoUrlPreviewMetadata;

interface MediaDownloadState {
  jobs: MediaDownloadJob[];
  enqueueDownloads: (requests: MediaDownloadRequest[]) => string[];
  enqueueUrls: (urls: string[]) => string[];
  retryJob: (jobId: string) => void;
  dismissJob: (jobId: string) => void;
}

const MAX_RUNNING_DOWNLOADS = 2;
const pendingJobIds: string[] = [];
let runningCount = 0;

const PLATFORM_ORIGIN_PROVIDERS: Record<string, ExternalMediaProvider> = {
  youtube: 'youtube',
  tiktok: 'tiktok',
  instagram: 'instagram',
  twitter: 'x',
  facebook: 'facebook',
  reddit: 'reddit',
  vimeo: 'vimeo',
  twitch: 'twitch',
  dailymotion: 'dailymotion',
  generic: 'web-download',
};

function formatDuration(seconds: number): string {
  if (!seconds || !Number.isFinite(seconds)) return '?:??';
  const rounded = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function metadataFromVideoInfo(url: string, info: VideoInfo): ResolvedDownloadMetadata {
  return {
    url,
    downloadKey: createDownloadKey(url),
    title: info.title || 'Untitled',
    thumbnail: info.thumbnail || '',
    channel: info.uploader || 'Unknown',
    platform: detectDownloadPlatform(url) || info.platform || 'generic',
    durationSeconds: Math.round(info.duration || 0),
  };
}

async function resolveDownloadMetadata(url: string): Promise<ResolvedDownloadMetadata> {
  const videoId = extractVideoId(url);
  if (videoId) {
    const youtubeMetadata = await fetchYouTubePreviewMetadata(url, videoId);
    if (youtubeMetadata) return youtubeMetadata;
  }

  if (!isDownloadAvailable()) {
    throw new Error('Native Helper is required for downloads.');
  }

  const info = await NativeHelperClient.listFormats(url);
  if (!info) {
    throw new Error('Could not load video metadata. The URL may not be supported.');
  }

  return metadataFromVideoInfo(url, info);
}

function getOrCreateDownloadFolder(platform: string): string {
  const mediaStore = useMediaStore.getState();
  let downloadsFolder = mediaStore.folders.find((folder) => folder.name === 'Downloads' && folder.parentId === null);
  if (!downloadsFolder) {
    downloadsFolder = mediaStore.createFolder('Downloads');
  }

  const folderName = DOWNLOAD_PLATFORM_LABELS[platform] ?? 'Other';
  let platformFolder = useMediaStore.getState().folders.find(
    (folder) => folder.name === folderName && folder.parentId === downloadsFolder.id,
  );
  if (!platformFolder) {
    platformFolder = useMediaStore.getState().createFolder(folderName, downloadsFolder.id);
  }

  return platformFolder.id;
}

export function externalOriginForDownload(metadata: ResolvedDownloadMetadata): ExternalMediaOrigin {
  return {
    provider: PLATFORM_ORIGIN_PROVIDERS[metadata.platform] ?? 'web-download',
    providerLabel: DOWNLOAD_PLATFORM_LABELS[metadata.platform] ?? 'Web download',
    assetId: metadata.downloadKey,
    sourcePageUrl: metadata.url,
    originalUrl: metadata.url,
    creator: metadata.channel || undefined,
    licenseName: 'Rights not verified',
    rightsStatus: 'rights-unverified',
    rightsNote: 'Imported from a user-selected URL through the local Native Helper. Verify reuse rights before publishing.',
    retrievedAt: new Date().toISOString(),
  };
}

async function importDownloadedFile(file: File, metadata: ResolvedDownloadMetadata): Promise<MediaFile> {
  const folderId = getOrCreateDownloadFolder(metadata.platform);
  return requireMediaFileImportResult(
    await useMediaStore.getState().importFile(file, folderId, {
      forceCopyToProject: true,
      externalOrigin: externalOriginForDownload(metadata),
    }),
    'Media download import',
  );
}

function rememberDownloadForLegacyTools(metadata: ResolvedDownloadMetadata): void {
  useYouTubeStore.getState().addVideo({
    id: metadata.downloadKey,
    title: metadata.title,
    thumbnail: metadata.thumbnail,
    channelTitle: metadata.channel,
    publishedAt: new Date().toISOString(),
    duration: formatDuration(metadata.durationSeconds),
    durationSeconds: metadata.durationSeconds,
    platform: metadata.platform,
    sourceUrl: metadata.url,
  });
}

function updateJob(jobId: string, patch: Partial<MediaDownloadJob>): void {
  useMediaDownloadStore.setState((state) => ({
    jobs: state.jobs.map((job) => (
      job.id === jobId ? { ...job, ...patch } : job
    )),
  }));
}

function getJob(jobId: string): MediaDownloadJob | undefined {
  return useMediaDownloadStore.getState().jobs.find((job) => job.id === jobId);
}

function processDownloadQueue(): void {
  while (runningCount < MAX_RUNNING_DOWNLOADS && pendingJobIds.length > 0) {
    const jobId = pendingJobIds.shift();
    if (!jobId) continue;
    const job = getJob(jobId);
    if (!job || job.status !== 'queued') continue;
    void runDownloadJob(jobId);
  }
}

async function runDownloadJob(jobId: string): Promise<void> {
  runningCount += 1;
  updateJob(jobId, {
    status: 'processing',
    startedAt: Date.now(),
    error: undefined,
    progress: 0.01,
  });

  try {
    const current = getJob(jobId);
    if (!current) return;
    const requestedFormatId = current.formatId;

    const metadata: ResolvedDownloadMetadata = current.metadataResolved
      ? {
          url: current.url,
          downloadKey: current.downloadKey,
          title: current.title,
          thumbnail: current.thumbnail,
          channel: current.channel,
          platform: current.platform,
          durationSeconds: current.durationSeconds,
        }
      : await resolveDownloadMetadata(current.url);
    rememberDownloadForLegacyTools(metadata);
    updateJob(jobId, {
      downloadKey: metadata.downloadKey,
      title: metadata.title,
      thumbnail: metadata.thumbnail,
      channel: metadata.channel,
      platform: metadata.platform,
      durationSeconds: metadata.durationSeconds,
      progress: 0.03,
    });

    let file: File | null = null;
    if (!requestedFormatId && projectFileService.isProjectOpen()) {
      const existing = await projectFileService.getDownloadFile(metadata.title, metadata.platform);
      if (existing) {
        file = existing;
        updateJob(jobId, { progress: 0.9 });
      }
    }

    if (!file) {
      file = await downloadVideo(
        metadata.url,
        metadata.downloadKey,
        metadata.title,
        metadata.thumbnail,
        requestedFormatId,
        (progress: DownloadProgress) => {
          if (progress.status === 'downloading' || progress.status === 'processing') {
            updateJob(jobId, {
              progress: Math.max(0.03, Math.min(0.96, progress.progress / 100)),
              speed: progress.speed,
            });
          }
        },
        metadata.platform,
      );
    }

    const mediaFile = await importDownloadedFile(file, metadata);
    updateJob(jobId, {
      status: 'completed',
      completedAt: Date.now(),
      progress: 1,
      mediaFileId: mediaFile.id,
      fileName: file.name,
      speed: undefined,
    });
  } catch (error) {
    updateJob(jobId, {
      status: 'failed',
      completedAt: Date.now(),
      error: error instanceof Error ? error.message : 'Download failed',
      speed: undefined,
    });
  } finally {
    runningCount = Math.max(0, runningCount - 1);
    processDownloadQueue();
  }
}

export const useMediaDownloadStore = create<MediaDownloadState>((set, get) => ({
  jobs: [],

  enqueueDownloads: (requests) => {
    const now = Date.now();
    const activeUrls = new Set(
      get().jobs
        .filter((job) => job.status === 'queued' || job.status === 'processing')
        .map((job) => job.url),
    );
    const seenUrls = new Set<string>();
    const uniqueRequests = requests.filter((request) => {
      if (seenUrls.has(request.url) || activeUrls.has(request.url)) {
        return false;
      }
      seenUrls.add(request.url);
      return true;
    });
    const jobs = uniqueRequests.map((request): MediaDownloadJob => ({
      id: `download-${now}-${Math.random().toString(36).slice(2, 9)}`,
      url: request.url,
      downloadKey: createDownloadKey(request.url),
      formatId: request.formatId,
      formatLabel: request.formatLabel,
      metadataResolved: Boolean(request.metadata),
      title: request.metadata?.title ?? 'Resolving download...',
      thumbnail: request.metadata?.thumbnail ?? '',
      channel: request.metadata?.channel ?? '',
      platform: request.metadata?.platform ?? detectDownloadPlatform(request.url),
      durationSeconds: request.metadata?.durationSeconds ?? 0,
      status: 'queued',
      createdAt: now,
    }));

    if (jobs.length === 0) {
      return [];
    }

    set((state) => ({ jobs: [...state.jobs, ...jobs] }));
    pendingJobIds.push(...jobs.map((job) => job.id));
    queueMicrotask(processDownloadQueue);
    return jobs.map((job) => job.id);
  },

  enqueueUrls: (urls) => get().enqueueDownloads(urls.map((url) => ({ url }))),

  retryJob: (jobId) => {
    const job = get().jobs.find((candidate) => candidate.id === jobId);
    if (!job || job.status === 'queued' || job.status === 'processing') return;
    set((state) => ({
      jobs: state.jobs.map((candidate) => (
        candidate.id === jobId
          ? {
              ...candidate,
              status: 'queued',
              progress: undefined,
              speed: undefined,
              error: undefined,
              startedAt: undefined,
              completedAt: undefined,
              mediaFileId: undefined,
            }
          : candidate
      )),
    }));
    pendingJobIds.push(jobId);
    queueMicrotask(processDownloadQueue);
  },

  dismissJob: (jobId) => {
    const pendingIndex = pendingJobIds.indexOf(jobId);
    if (pendingIndex >= 0) {
      pendingJobIds.splice(pendingIndex, 1);
    }
    set((state) => ({ jobs: state.jobs.filter((job) => job.id !== jobId) }));
  },
}));
