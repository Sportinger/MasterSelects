import { create } from 'zustand';
import { NativeHelperClient, type VideoInfo } from '../services/nativeHelper';
import { projectFileService } from '../services/projectFileService';
import { downloadVideo, isDownloadAvailable, type DownloadProgress } from '../services/youtubeDownloader';
import { useMediaStore, type MediaFile } from './mediaStore';
import { requireMediaFileImportResult } from './mediaStore/helpers/importResult';
import { useYouTubeStore } from './youtubeStore';

export type MediaDownloadJobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'canceled';

export interface MediaDownloadJob {
  id: string;
  url: string;
  downloadKey: string;
  formatId?: string;
  formatLabel?: string;
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
}

interface ResolvedDownloadMetadata {
  url: string;
  downloadKey: string;
  title: string;
  thumbnail: string;
  channel: string;
  platform: string;
  durationSeconds: number;
}

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

const PLATFORM_FOLDER_LABELS: Record<string, string> = {
  youtube: 'YouTube',
  tiktok: 'TikTok',
  instagram: 'Instagram',
  twitter: 'Twitter',
  facebook: 'Facebook',
  reddit: 'Reddit',
  vimeo: 'Vimeo',
  twitch: 'Twitch',
  dailymotion: 'Dailymotion',
  generic: 'Other',
};

export function parseDownloadUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match.replace(/[),.;]+$/g, '');
    if (!isSupportedVideoUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) return match[1];
  }
  return null;
}

export function detectDownloadPlatform(url: string): string {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (hostname.includes('youtube.com') || hostname.includes('youtu.be')) return 'youtube';
    if (hostname.includes('tiktok.com')) return 'tiktok';
    if (hostname.includes('instagram.com')) return 'instagram';
    if (hostname.includes('twitter.com') || hostname.includes('x.com')) return 'twitter';
    if (hostname.includes('facebook.com') || hostname.includes('fb.watch')) return 'facebook';
    if (hostname.includes('reddit.com')) return 'reddit';
    if (hostname.includes('vimeo.com')) return 'vimeo';
    if (hostname.includes('twitch.tv')) return 'twitch';
    if (hostname.includes('dailymotion.com')) return 'dailymotion';
  } catch {
    return 'generic';
  }

  return 'generic';
}

function isSupportedVideoUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function createDownloadKey(url: string): string {
  const videoId = extractVideoId(url);
  if (videoId) return videoId;

  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `url-${Math.abs(hash).toString(36)}`;
}

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

async function getYouTubeMetadata(url: string, videoId: string): Promise<ResolvedDownloadMetadata | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
    );
    if (!response.ok) return null;
    const data = await response.json() as { title?: string; author_name?: string };
    return {
      url,
      downloadKey: videoId,
      title: data.title || 'Untitled',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      channel: data.author_name || 'Unknown',
      platform: 'youtube',
      durationSeconds: 0,
    };
  } catch {
    return null;
  }
}

function metadataFromVideoInfo(url: string, info: VideoInfo): ResolvedDownloadMetadata {
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
    const youtubeMetadata = await getYouTubeMetadata(url, videoId);
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

  const folderName = PLATFORM_FOLDER_LABELS[platform] ?? 'Other';
  let platformFolder = useMediaStore.getState().folders.find(
    (folder) => folder.name === folderName && folder.parentId === downloadsFolder.id,
  );
  if (!platformFolder) {
    platformFolder = useMediaStore.getState().createFolder(folderName, downloadsFolder.id);
  }

  return platformFolder.id;
}

async function importDownloadedFile(file: File, platform: string): Promise<MediaFile> {
  const folderId = getOrCreateDownloadFolder(platform);
  return requireMediaFileImportResult(
    await useMediaStore.getState().importFile(file, folderId, {
      forceCopyToProject: true,
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

    const metadata = await resolveDownloadMetadata(current.url);
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

    const mediaFile = await importDownloadedFile(file, metadata.platform);
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
      title: 'Resolving download...',
      thumbnail: '',
      channel: '',
      platform: detectDownloadPlatform(request.url),
      durationSeconds: 0,
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
