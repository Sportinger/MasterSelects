// YouTube AI Tool Handlers

import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper';
import { downloadVideo } from '../../youtubeDownloader';
import { useYouTubeStore } from '../../../stores/youtubeStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { ToolResult } from '../types';

const log = Logger.create('AITool:YouTube');

// --- Helpers ---

function formatDuration(seconds: number): string {
  if (!seconds) return '?:??';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function formatViews(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
  return `${count} views`;
}

// --- Handlers ---

export async function handleSearchVideos(args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;
  const maxResults = Math.min(Math.max((args.maxResults as number) || 5, 1), 20);
  const maxDuration = args.maxDuration as number | undefined;
  const minDuration = args.minDuration as number | undefined;

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  if (!NativeHelperClient.isConnected()) {
    return { success: false, error: 'Native Helper not connected. Please start the helper application and enable Turbo Mode in settings.' };
  }

  try {
    // Request extra results if filtering by duration (some may be filtered out)
    const requestCount = (maxDuration || minDuration) ? Math.min(maxResults * 3, 20) : maxResults;
    const results = await NativeHelperClient.searchVideos(query, requestCount);

    if (!results) {
      return { success: false, error: 'Search failed. yt-dlp may not be installed or the Native Helper timed out.' };
    }

    // Apply duration filters
    let filtered = results;
    if (maxDuration) {
      filtered = filtered.filter(r => r.duration != null && r.duration <= maxDuration);
    }
    if (minDuration) {
      filtered = filtered.filter(r => r.duration != null && r.duration >= minDuration);
    }

    // Limit to requested count
    filtered = filtered.slice(0, maxResults);

    // Format for AI response
    const videos = filtered.map(r => ({
      id: r.id,
      title: r.title,
      url: r.url,
      thumbnail: r.thumbnail,
      channelTitle: r.uploader,
      durationSeconds: r.duration,
      duration: r.duration ? formatDuration(r.duration) : '?:??',
      viewCount: r.view_count ? formatViews(r.view_count) : undefined,
    }));

    // Add results to YouTube store (appears in Downloads panel)
    useYouTubeStore.getState().addVideos(videos.map(v => ({
      id: v.id,
      title: v.title,
      thumbnail: v.thumbnail,
      channelTitle: v.channelTitle,
      publishedAt: '',
      durationSeconds: v.durationSeconds || 0,
      duration: v.duration,
      viewCount: v.viewCount,
      sourceUrl: v.url,
    })));
    useYouTubeStore.getState().setLastQuery(query);

    log.info(`Video search: "${query}" returned ${videos.length} results`);

    return {
      success: true,
      data: {
        query,
        resultCount: videos.length,
        videos,
      },
    };
  } catch (error) {
    log.error('Video search failed', error);
    return {
      success: false,
      error: `Video search failed: ${(error as Error).message}`,
    };
  }
}

export async function handleListVideoFormats(args: Record<string, unknown>): Promise<ToolResult> {
  let url = args.url as string;

  if (!url) {
    return { success: false, error: 'url is required' };
  }

  // If just a video ID, convert to YouTube URL
  if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
    url = `https://www.youtube.com/watch?v=${url}`;
  }

  if (!NativeHelperClient.isConnected()) {
    return { success: false, error: 'Native Helper not connected. Please start the helper application and enable Turbo Mode in settings.' };
  }

  try {
    const info = await NativeHelperClient.listFormats(url);

    if (!info) {
      return { success: false, error: 'Failed to get video info. The URL may be invalid or unsupported.' };
    }

    log.info(`Listed formats for: ${info.title} (${info.recommendations.length} recommendations, ${info.allFormats.length} formats)`);

    return {
      success: true,
      data: {
        title: info.title,
        duration: info.duration,
        uploader: info.uploader,
        platform: info.platform,
        thumbnail: info.thumbnail,
        recommendations: info.recommendations.map(r => ({
          id: r.id,
          label: r.label,
          resolution: r.resolution,
          videoCodec: r.vcodec,
          audioCodec: r.acodec,
          needsMerge: r.needsMerge,
        })),
        allFormats: info.allFormats.map(f => ({
          formatId: f.format_id,
          ext: f.ext,
          resolution: f.resolution,
          fps: f.fps,
          videoCodec: f.vcodec,
          audioCodec: f.acodec,
          filesize: f.filesize,
          bitrate: f.tbr,
          note: f.format_note,
          hasVideo: f.hasVideo,
          hasAudio: f.hasAudio,
        })),
      },
    };
  } catch (error) {
    log.error('List formats failed', error);
    return {
      success: false,
      error: `Failed to list formats: ${(error as Error).message}`,
    };
  }
}

export async function handleDownloadAndImportVideo(args: Record<string, unknown>): Promise<ToolResult> {
  const url = args.url as string;
  const title = args.title as string;
  const formatId = args.formatId as string | undefined;
  const thumbnail = (args.thumbnail as string) || '';

  if (!url) {
    return { success: false, error: 'url is required' };
  }
  if (!title) {
    return { success: false, error: 'title is required' };
  }

  if (!NativeHelperClient.isConnected()) {
    return { success: false, error: 'Native Helper not connected. Please start the helper application and enable Turbo Mode in settings.' };
  }

  // Extract video ID for tracking
  const videoIdMatch = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
  const videoId = videoIdMatch ? videoIdMatch[1] : url.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);

  const timelineStore = useTimelineStore.getState();

  // Find or create a video track
  let videoTrack = timelineStore.tracks.find(t => t.type === 'video');
  if (!videoTrack) {
    timelineStore.addTrack('video');
    videoTrack = useTimelineStore.getState().tracks.find(t => t.type === 'video');
    if (!videoTrack) {
      return { success: false, error: 'Failed to create video track' };
    }
  }

  // Add pending clip at end of timeline
  const startTime = timelineStore.duration || 0;
  const clipId = timelineStore.addPendingDownloadClip(
    videoTrack.id,
    startTime,
    videoId,
    title,
    thumbnail,
    30 // estimated duration
  );

  if (!clipId) {
    return { success: false, error: 'Failed to create pending download clip' };
  }

  log.info(`Starting download: ${title} (${url}), clipId: ${clipId}`);

  try {
    // Download and wait for completion
    const file = await downloadVideo(
      url,
      videoId,
      title,
      thumbnail,
      formatId,
      (progress) => {
        // Update pending clip progress
        const store = useTimelineStore.getState();
        if (progress.status === 'downloading' || progress.status === 'processing') {
          store.updateDownloadProgress(clipId, progress.progress);
        } else if (progress.status === 'error') {
          store.setDownloadError(clipId, progress.error || 'Download failed');
        }
      }
    );

    // Complete the download — convert pending clip to real clip
    await useTimelineStore.getState().completeDownload(clipId, file);

    log.info(`Download complete: ${title}, file size: ${(file.size / 1024 / 1024).toFixed(1)}MB`);

    return {
      success: true,
      data: {
        clipId,
        title,
        fileName: file.name,
        fileSize: file.size,
        message: `Video "${title}" downloaded and imported to timeline.`,
      },
    };
  } catch (error) {
    log.error('Download failed', error);
    // Mark clip as errored
    useTimelineStore.getState().setDownloadError(clipId, (error as Error).message);
    return {
      success: false,
      error: `Download failed: ${(error as Error).message}`,
    };
  }
}

export async function handleGetYouTubeVideos(): Promise<ToolResult> {
  const { videos } = useYouTubeStore.getState();

  return {
    success: true,
    data: {
      videoCount: videos.length,
      videos: videos.map(v => ({
        id: v.id,
        title: v.title,
        channel: v.channelTitle,
        duration: v.duration,
        durationSeconds: v.durationSeconds,
        views: v.viewCount,
        platform: v.platform || 'youtube',
        url: v.sourceUrl || `https://www.youtube.com/watch?v=${v.id}`,
        thumbnail: v.thumbnail,
      })),
    },
  };
}
