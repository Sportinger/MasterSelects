// YouTube AI Tool Handlers

import { Logger } from '../../logger';
import { NativeHelperClient } from '../../nativeHelper';
import { downloadVideo } from '../../youtubeDownloader';
import { useYouTubeStore } from '../../../stores/youtubeStore';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { ToolResult } from '../types';

const log = Logger.create('AITool:YouTube');

// --- Helpers (replicated from DownloadPanel) ---

function parseISO8601Duration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return parseInt(match[1] || '0') * 3600 + parseInt(match[2] || '0') * 60 + parseInt(match[3] || '0');
}

function formatDuration(seconds: number): string {
  if (!seconds) return '?:??';
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
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

export async function handleSearchYouTube(args: Record<string, unknown>): Promise<ToolResult> {
  const query = args.query as string;
  const maxResults = Math.min(Math.max((args.maxResults as number) || 10, 1), 20);

  if (!query) {
    return { success: false, error: 'query is required' };
  }

  if (!NativeHelperClient.isConnected()) {
    return { success: false, error: 'Native Helper not connected. Please start the helper application to use video search.' };
  }

  try {
    // Search via yt-dlp through Native Helper (no API key needed)
    const results = await NativeHelperClient.searchVideos(query, maxResults);

    if (!results || results.length === 0) {
      return { success: true, data: { query, resultCount: 0, videos: [] } };
    }

    const videos = results.map((item: any) => ({
      id: item.id,
      title: item.title,
      thumbnail: item.thumbnail || '',
      channelTitle: item.uploader || item.channel || '',
      publishedAt: item.upload_date || '',
      durationSeconds: item.duration || 0,
      duration: formatDuration(item.duration || 0),
      viewCount: item.view_count ? formatViews(item.view_count) : undefined,
      url: item.url || item.webpage_url || `https://www.youtube.com/watch?v=${item.id}`,
    }));

    // Add results to YouTube store (appears in Downloads panel)
    useYouTubeStore.getState().addVideos(videos);
    useYouTubeStore.getState().setLastQuery(query);

    log.info(`yt-dlp search: "${query}" returned ${videos.length} results`);

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
    return { success: false, error: 'Native Helper not connected. Please start the helper application and enable Native Helper in settings.' };
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
  const compositionId = args.compositionId as string | undefined;
  const explicitStartTime = args.startTime as number | undefined;

  if (!url) {
    return { success: false, error: 'url is required' };
  }
  if (!title) {
    return { success: false, error: 'title is required' };
  }

  if (!NativeHelperClient.isConnected()) {
    return { success: false, error: 'Native Helper not connected. Please start the helper application and enable Native Helper in settings.' };
  }

  // Switch to target composition if specified
  if (compositionId) {
    const mediaStore = useMediaStore.getState();
    const comp = mediaStore.compositions.find(c => c.id === compositionId);
    if (!comp) {
      return { success: false, error: `Composition not found: ${compositionId}` };
    }
    mediaStore.openCompositionTab(compositionId);
    // Wait a tick for state to propagate
    await new Promise(resolve => setTimeout(resolve, 50));
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

  // Calculate start time:
  // 1. Explicit startTime from args takes priority
  // 2. If no clips exist, place at 0 (not at default duration of 60)
  // 3. Otherwise append after last clip
  const startTime = explicitStartTime ?? (timelineStore.clips.length > 0
    ? Math.max(...timelineStore.clips.map(c => c.startTime + c.duration))
    : 0);
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
          store.updateDownloadProgress(clipId, progress.progress, progress.speed);
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
