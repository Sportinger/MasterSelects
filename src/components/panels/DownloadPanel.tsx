// YouTube Search Panel
// Supports YouTube Data API (with key) and direct URL paste (no key)

import { useState, useCallback, useRef, useEffect } from 'react';
import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import { useYouTubeStore, type YouTubeVideo as StoreYouTubeVideo } from '../../stores/youtubeStore';
import { downloadYouTubeVideo, downloadVideo, subscribeToDownload, isDownloadAvailable, type DownloadProgress } from '../../services/youtubeDownloader';
import { NativeHelperClient } from '../../services/nativeHelper';
import type { VideoInfo } from '../../services/nativeHelper';
import { projectFileService } from '../../services/projectFileService';
import { setExternalDragPayload, clearExternalDragPayload } from '../timeline/utils/externalDragSession';
import './DownloadPanel.css';

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: string;
  duration: string;
  durationSeconds: number;
  views?: string;
  platform?: string;
  sourceUrl?: string;
}

// Convert store video to panel format
function storeToPanel(v: StoreYouTubeVideo): YouTubeVideo {
  return {
    id: v.id,
    title: v.title,
    thumbnail: v.thumbnail,
    channel: v.channelTitle,
    duration: v.duration || '?:??',
    durationSeconds: v.durationSeconds || 0,
    views: v.viewCount,
    platform: v.platform,
    sourceUrl: v.sourceUrl,
  };
}

// Convert panel video to store format
function panelToStore(v: YouTubeVideo): StoreYouTubeVideo {
  return {
    id: v.id,
    title: v.title,
    thumbnail: v.thumbnail,
    channelTitle: v.channel,
    publishedAt: new Date().toISOString(),
    duration: v.duration,
    durationSeconds: v.durationSeconds,
    viewCount: v.views,
    platform: v.platform,
    sourceUrl: v.sourceUrl,
  };
}

// Extract video ID from various YouTube URL formats
function extractVideoId(input: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /^([a-zA-Z0-9_-]{11})$/, // Just the ID
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// Detect platform from URL
function detectPlatform(url: string): string | null {
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
    return 'generic';
  } catch {
    return null;
  }
}

// Check if a string looks like a supported video URL (not YouTube-specific)
function isSupportedVideoUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// Get video info via YouTube oEmbed (supports CORS!)
async function getVideoInfo(videoId: string): Promise<YouTubeVideo | null> {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
    );
    if (!response.ok) return null;

    const data = await response.json();
    return {
      id: videoId,
      title: data.title || 'Untitled',
      thumbnail: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
      channel: data.author_name || 'Unknown',
      duration: '?:??', // oEmbed doesn't provide duration
      durationSeconds: 0,
    };
  } catch {
    return null;
  }
}

// Format selection dialog
function FormatDialog({
  videoInfo,
  onSelect,
  onCancel,
}: {
  videoInfo: VideoInfo;
  onSelect: (formatId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div className="format-dialog-backdrop" onClick={onCancel}>
      <div className="format-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="format-dialog-header">
          <h3>Select Quality</h3>
          <button className="format-dialog-close" onClick={onCancel}>×</button>
        </div>

        <div className="format-dialog-video">
          <img src={videoInfo.thumbnail} alt={videoInfo.title} />
          <div className="format-dialog-info">
            <span className="format-dialog-title">{videoInfo.title}</span>
            <span className="format-dialog-uploader">{videoInfo.uploader}</span>
          </div>
        </div>

        <div className="format-dialog-options">
          {videoInfo.recommendations.map((format) => (
            <button
              key={format.id}
              className="format-option"
              onClick={() => onSelect(format.id)}
            >
              <span className="format-label">{format.label}</span>
              <span className="format-details">
                {format.vcodec && <span className="format-codec">{format.vcodec.split('.')[0]}</span>}
                {format.acodec && <span className="format-codec">{format.acodec.split('.')[0]}</span>}
              </span>
            </button>
          ))}
        </div>

        <button className="format-dialog-cancel" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DownloadPanel() {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draggingVideo, setDraggingVideo] = useState<string | null>(null);
  const [autoDownload, setAutoDownload] = useState(false);
  const [downloadingVideos, setDownloadingVideos] = useState<Set<string>>(new Set());
  const [downloadProgressMap, setDownloadProgressMap] = useState<Map<string, { progress: number; speed?: string }>>(new Map());
  const [helperConnected, setHelperConnected] = useState(isDownloadAvailable());
  const [downloadedVideos, setDownloadedVideos] = useState<Set<string>>(new Set());

  // YouTube store - videos persist with project
  const storeVideos = useYouTubeStore(s => s.videos);
  const addVideos = useYouTubeStore(s => s.addVideos);
  const _removeVideo = useYouTubeStore(s => s.removeVideo); // For future use
  const _clearVideos = useYouTubeStore(s => s.clearVideos); // For future use
  void _removeVideo; void _clearVideos; // Suppress unused warnings

  // Convert store videos to panel format
  const results = storeVideos.map(storeToPanel);

  // Format selection state
  const [formatDialog, setFormatDialog] = useState<{
    video: YouTubeVideo;
    info: VideoInfo;
    mode: 'download' | 'timeline';
  } | null>(null);
  const [fetchingFormats, setFetchingFormats] = useState<string | null>(null);


  // Track Native Helper connection status
  useEffect(() => {
    const unsubscribe = NativeHelperClient.onStatusChange((status) => {
      setHelperConnected(status === 'connected');
    });
    return unsubscribe;
  }, []);

  // Check which videos are already downloaded
  useEffect(() => {
    if (!projectFileService.isProjectOpen()) return;
    let cancelled = false;
    (async () => {
      const found = new Set<string>();
      for (const v of storeVideos) {
        const exists = await projectFileService.checkDownloadExists(v.title, v.platform || 'youtube');
        if (cancelled) return;
        if (exists) found.add(v.id);
      }
      setDownloadedVideos(found);
    })();
    return () => { cancelled = true; };
  }, [storeVideos]);

  // Import file from mediaStore
  const importFile = useMediaStore(s => s.importFile);

  // Timeline store actions
  const addPendingDownloadClip = useTimelineStore(s => s.addPendingDownloadClip);
  const updateDownloadProgress = useTimelineStore(s => s.updateDownloadProgress);
  const completeDownload = useTimelineStore(s => s.completeDownload);
  const setDownloadError = useTimelineStore(s => s.setDownloadError);
  const tracks = useTimelineStore(s => s.tracks);
  const playheadPosition = useTimelineStore(s => s.playheadPosition);

  // Track active downloads
  const activeDownloadsRef = useRef<Set<string>>(new Set());

  // Format duration from seconds
  const formatDuration = (seconds: number): string => {
    if (!seconds) return '?:??';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Parse ISO 8601 duration
  const parseISO8601Duration = (duration: string): number => {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    return parseInt(match[1] || '0') * 3600 + parseInt(match[2] || '0') * 60 + parseInt(match[3] || '0');
  };

  // Format view count
  const formatViews = (count: number): string => {
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M views`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}K views`;
    return `${count} views`;
  };

  // Main search/add handler
  const handleSearch = useCallback(async (overrideQuery?: string) => {
    const input = (overrideQuery ?? query).trim();
    if (!input) return;

    setLoading(true);
    setError(null);

    try {
      // Check if it's a YouTube URL or video ID
      const videoId = extractVideoId(input);

      if (videoId) {
        // YouTube URL/ID - get info via oEmbed
        const videoInfo = await getVideoInfo(videoId);
        if (videoInfo) {
          videoInfo.platform = 'youtube';
          videoInfo.sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;
          addVideos([panelToStore(videoInfo)]);
          setQuery('');
          if (autoDownload) {
            downloadVideoOnly(videoInfo);
          }
        } else {
          setError('Could not load video info');
        }
      } else if (isSupportedVideoUrl(input)) {
        // Non-YouTube video URL — use yt-dlp to get metadata
        const platform = detectPlatform(input);
        if (!helperConnected) {
          setError('Native Helper required for non-YouTube URLs');
        } else {
          const info = await NativeHelperClient.listFormats(input);
          if (info) {
            // Generate a stable ID from the URL
            const urlId = btoa(input).replace(/[^a-zA-Z0-9]/g, '').substring(0, 16);
            const video: YouTubeVideo = {
              id: urlId,
              title: info.title || 'Untitled',
              thumbnail: info.thumbnail || '',
              channel: info.uploader || 'Unknown',
              duration: info.duration ? formatDuration(Math.round(info.duration)) : '?:??',
              durationSeconds: Math.round(info.duration || 0),
              platform: platform || info.platform || 'generic',
              sourceUrl: input,
            };
            addVideos([panelToStore(video)]);
            setQuery('');
            if (autoDownload) {
              downloadVideoOnly(video);
            }
          } else {
            setError('Could not load video info. URL may not be supported.');
          }
        }
      } else if (helperConnected) {
        // Search via yt-dlp (no API key needed)
        const results = await NativeHelperClient.searchVideos(input, 10);
        if (results && results.length > 0) {
          const videos = results.map((item: any) => ({
            id: item.id,
            title: item.title || 'Untitled',
            thumbnail: item.thumbnail || '',
            channel: item.uploader || item.channel || '',
            duration: formatDuration(item.duration || 0),
            durationSeconds: item.duration || 0,
            views: item.view_count ? formatViews(item.view_count) : undefined,
            platform: 'youtube' as const,
            sourceUrl: item.url || item.webpage_url || `https://www.youtube.com/watch?v=${item.id}`,
          }));
          addVideos(videos.map(panelToStore));
        } else {
          setError('No results found');
        }
      } else {
        setError('Paste a video URL, or start Native Helper for search');
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, autoDownload, helperConnected]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Handle paste - auto-add if it's a video URL
  const handlePaste = (e: React.ClipboardEvent) => {
    const pastedText = e.clipboardData.getData('text').trim();
    const videoId = extractVideoId(pastedText);

    if (videoId || isSupportedVideoUrl(pastedText)) {
      e.preventDefault();
      setQuery(pastedText);
      handleSearch(pastedText);
    }
  };

  // Get the source URL for a video (handles both YouTube and other platforms)
  const getVideoUrl = (video: YouTubeVideo): string => {
    return video.sourceUrl || `https://www.youtube.com/watch?v=${video.id}`;
  };

  // Open video in new tab
  const openVideo = (video: YouTubeVideo) => {
    window.open(getVideoUrl(video), '_blank');
  };

  // Copy video URL
  const copyVideoUrl = (video: YouTubeVideo) => {
    navigator.clipboard.writeText(getVideoUrl(video));
  };

  // Pre-import downloaded files so they're ready for instant drag
  const importedMediaRef = useRef<Map<string, { mediaId: string; file: File; duration?: number; hasAudio?: boolean }>>(new Map());

  // When downloadedVideos changes, pre-import them into media store
  useEffect(() => {
    let cancelled = false;
    (async () => {
      for (const video of results) {
        if (!downloadedVideos.has(video.id)) continue;
        if (importedMediaRef.current.has(video.id)) continue;
        const file = await projectFileService.getDownloadFile(video.title, video.platform || 'youtube');
        if (cancelled || !file) continue;
        const mediaFile = await importFile(file);
        if (cancelled || !mediaFile) continue;
        importedMediaRef.current.set(video.id, {
          mediaId: mediaFile.id,
          file,
          duration: mediaFile.duration || video.durationSeconds,
          hasAudio: mediaFile.hasAudio !== false,
        });
      }
    })();
    return () => { cancelled = true; };
  }, [downloadedVideos, results]);

  // Drag handlers — downloaded videos can be dragged directly to timeline
  const handleDragStart = (e: React.DragEvent, video: YouTubeVideo) => {
    setDraggingVideo(video.id);
    clearExternalDragPayload();

    const imported = importedMediaRef.current.get(video.id);
    if (imported) {
      // Already downloaded + imported — drag as media file to timeline
      setExternalDragPayload({
        kind: 'media-file',
        id: imported.mediaId,
        duration: imported.duration,
        hasAudio: imported.hasAudio,
        isAudio: false,
        isVideo: true,
        file: imported.file,
      });
      e.dataTransfer.setData('application/x-media-file-id', imported.mediaId);
      e.dataTransfer.effectAllowed = 'copyMove';
    } else {
      // Not downloaded yet — just visual drag, no timeline drop
      e.dataTransfer.setData('text/plain', video.title);
      e.dataTransfer.effectAllowed = 'copy';
    }
  };

  const handleDragEnd = () => {
    setDraggingVideo(null);
    clearExternalDragPayload();
  };

  // Show format selection dialog before download
  const showFormatDialog = async (video: YouTubeVideo, mode: 'download' | 'timeline') => {
    if (fetchingFormats) return;

    setFetchingFormats(video.id);
    setError(null);

    try {
      const url = getVideoUrl(video);
      const info = await NativeHelperClient.listFormats(url);

      if (info && info.recommendations.length > 0) {
        setFormatDialog({ video, info, mode });
      } else {
        // Fallback: download with default format
        if (mode === 'download') {
          await executeDownload(video);
        } else {
          await executeAddToTimeline(video);
        }
      }
    } catch (err) {
      setError(`Failed to fetch formats: ${(err as Error).message}`);
    } finally {
      setFetchingFormats(null);
    }
  };

  // Handle format selection from dialog
  const handleFormatSelect = async (formatId: string) => {
    if (!formatDialog) return;

    const { video, mode } = formatDialog;
    setFormatDialog(null);

    if (mode === 'download') {
      await executeDownload(video, formatId);
    } else {
      await executeAddToTimeline(video, formatId);
    }
  };

  // Download video only (save to downloads folder)
  const downloadVideoOnly = async (video: YouTubeVideo) => {
    if (downloadingVideos.has(video.id)) return;
    await showFormatDialog(video, 'download');
  };

  // Execute download with optional format
  const executeDownload = async (video: YouTubeVideo, formatId?: string) => {
    if (downloadingVideos.has(video.id)) return;

    setDownloadingVideos(prev => new Set(prev).add(video.id));

    const unsubscribe = subscribeToDownload(video.id, (p: DownloadProgress) => {
      if (p.status === 'downloading' || p.status === 'processing') {
        setDownloadProgressMap(prev => {
          const next = new Map(prev);
          next.set(video.id, { progress: p.progress, speed: p.speed });
          return next;
        });
      }
    });

    try {
      const videoUrl = getVideoUrl(video);
      if (video.sourceUrl && video.platform !== 'youtube') {
        await downloadVideo(videoUrl, video.id, video.title, video.thumbnail, formatId, undefined, video.platform);
      } else {
        await downloadYouTubeVideo(video.id, video.title, video.thumbnail, formatId);
      }
      // Mark as downloaded
      setDownloadedVideos(prev => new Set(prev).add(video.id));
    } catch (err) {
      setError(`Download failed: ${(err as Error).message}`);
    } finally {
      setDownloadingVideos(prev => {
        const next = new Set(prev);
        next.delete(video.id);
        return next;
      });
      setDownloadProgressMap(prev => {
        const next = new Map(prev);
        next.delete(video.id);
        return next;
      });
      unsubscribe();
    }
  };

  // Add video to timeline - show format dialog first
  const addVideoToTimeline = async (video: YouTubeVideo) => {
    if (activeDownloadsRef.current.has(video.id)) return;
    await showFormatDialog(video, 'timeline');
  };

  // Execute add to timeline with optional format
  const executeAddToTimeline = async (video: YouTubeVideo, formatId?: string) => {
    if (activeDownloadsRef.current.has(video.id)) return;

    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack) {
      setError('No video track available');
      return;
    }

    const clipId = addPendingDownloadClip(
      videoTrack.id,
      playheadPosition,
      video.id,
      video.title,
      video.thumbnail,
      video.durationSeconds || 60
    );

    if (!clipId) {
      setError('Failed to add clip');
      return;
    }

    activeDownloadsRef.current.add(video.id);
    setDownloadingVideos(prev => new Set(prev).add(video.id));

    const unsubscribe = subscribeToDownload(video.id, (progress: DownloadProgress) => {
      if (progress.status === 'downloading' || progress.status === 'processing') {
        updateDownloadProgress(clipId, progress.progress, progress.speed);
        setDownloadProgressMap(prev => {
          const next = new Map(prev);
          next.set(video.id, { progress: progress.progress, speed: progress.speed });
          return next;
        });
      }
    });

    try {
      const videoUrl = getVideoUrl(video);
      const file = video.sourceUrl && video.platform !== 'youtube'
        ? await downloadVideo(videoUrl, video.id, video.title, video.thumbnail, formatId, undefined, video.platform)
        : await downloadYouTubeVideo(video.id, video.title, video.thumbnail, formatId);
      await completeDownload(clipId, file);
      setDownloadedVideos(prev => new Set(prev).add(video.id));
    } catch (err) {
      setDownloadError(clipId, (err as Error).message);
    } finally {
      activeDownloadsRef.current.delete(video.id);
      setDownloadingVideos(prev => {
        const next = new Set(prev);
        next.delete(video.id);
        return next;
      });
      setDownloadProgressMap(prev => {
        const next = new Map(prev);
        next.delete(video.id);
        return next;
      });
      unsubscribe();
    }
  };

  return (
    <div className="youtube-panel">
      <div className="youtube-header">
        <div className="youtube-search-row">
          <input
            type="text"
            className="youtube-search-input"
            placeholder="Search or paste video URL..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
          />
          <button
            className="youtube-search-btn"
            onClick={() => handleSearch()}
            disabled={loading || !query.trim()}
          >
            {loading ? '...' : 'Search'}
          </button>
        </div>

        <div className="youtube-options">
          {helperConnected ? (
            <span className="api-status api-active">yt-dlp Ready</span>
          ) : (
            <span className="api-status api-warning">No Helper</span>
          )}
          <label className="auto-download-toggle" title={helperConnected ? "Auto-download when URL pasted" : "Native Helper required"}>
            <input
              type="checkbox"
              checked={autoDownload}
              onChange={(e) => setAutoDownload(e.target.checked)}
              disabled={!helperConnected}
            />
            <span>Auto Download</span>
          </label>
        </div>

        {!helperConnected && (
          <div className="youtube-hint youtube-hint-warning">
            Native Helper required for downloads. Start helper or use yt-dlp manually.
          </div>
        )}
      </div>

      {error && (
        <div className="youtube-error">
          <span className="error-icon">!</span>
          {error}
        </div>
      )}

      <div className="youtube-results">
        {loading ? (
          <div className="youtube-loading">
            <div className="loading-spinner" />
            <span>Loading...</span>
          </div>
        ) : results.length > 0 ? (
          <div className="youtube-grid">
            {results.map((video) => (
              <div
                key={video.id}
                className={`youtube-video-card ${draggingVideo === video.id ? 'dragging' : ''} ${downloadingVideos.has(video.id) ? 'downloading' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, video)}
                onDragEnd={handleDragEnd}
                onClick={() => openVideo(video)}
              >
                <div className="video-thumbnail">
                  <img src={video.thumbnail} alt={video.title} loading="lazy" draggable={false} />
                  {/* Text overlay on thumbnail */}
                  <div className="video-info-overlay">
                    <h4 className="video-title">{video.title}</h4>
                    <span className="video-channel">{video.channel}</span>
                  </div>
                  <span className="video-duration">{video.duration}</span>
                  {downloadedVideos.has(video.id) && (
                    <span className="video-downloaded-badge" title="Downloaded — drag to timeline">✓</span>
                  )}
                  {/* Action buttons */}
                  <div className="video-actions">
                    {downloadedVideos.has(video.id) ? (
                      <button
                        className="btn-download btn-redownload"
                        onClick={(e) => { e.stopPropagation(); downloadVideoOnly(video); }}
                        title="Re-download video"
                        disabled={downloadingVideos.has(video.id) || fetchingFormats === video.id || !helperConnected}
                      >
                        {downloadingVideos.has(video.id) || fetchingFormats === video.id ? '...' : '↻'}
                      </button>
                    ) : (
                      <button
                        className={`btn-download ${!helperConnected ? 'disabled' : ''}`}
                        onClick={(e) => { e.stopPropagation(); downloadVideoOnly(video); }}
                        title={helperConnected ? "Download video" : "Native Helper required for download"}
                        disabled={downloadingVideos.has(video.id) || fetchingFormats === video.id || !helperConnected}
                      >
                        {downloadingVideos.has(video.id) || fetchingFormats === video.id ? '...' : '↓'}
                      </button>
                    )}
                    <button
                      className={`btn-add-timeline ${fetchingFormats === video.id ? 'loading' : ''}`}
                      onClick={(e) => { e.stopPropagation(); addVideoToTimeline(video); }}
                      title={fetchingFormats === video.id ? "Loading formats..." : "Add to timeline"}
                      disabled={fetchingFormats === video.id || activeDownloadsRef.current.has(video.id)}
                    >
                      {fetchingFormats === video.id ? '...' : '+'}
                    </button>
                    <button
                      className="btn-copy-url"
                      onClick={(e) => { e.stopPropagation(); copyVideoUrl(video); }}
                      title="Copy URL"
                    >
                      Copy
                    </button>
                  </div>
                  {/* Fetching formats indicator */}
                  {fetchingFormats === video.id && (
                    <div className="download-overlay">
                      <div className="download-spinner" />
                      <span>Loading formats...</span>
                    </div>
                  )}
                  {/* Downloading indicator with progress */}
                  {downloadingVideos.has(video.id) && (
                    <div className="download-overlay">
                      <div className="download-spinner" />
                      <span>
                        {(() => {
                          const dp = downloadProgressMap.get(video.id);
                          if (!dp || dp.progress <= 0) return 'Downloading...';
                          const pct = Math.round(dp.progress);
                          return dp.speed ? `${pct}% · ${dp.speed}` : `${pct}%`;
                        })()}
                      </span>
                      {(() => {
                        const dp = downloadProgressMap.get(video.id);
                        if (!dp || dp.progress <= 0) return null;
                        return (
                          <div className="download-overlay-progress">
                            <div className="download-overlay-progress-bar" style={{ width: `${dp.progress}%` }} />
                          </div>
                        );
                      })()}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="youtube-empty">
            <span className="youtube-icon">Downloads</span>
            <p>Search or paste a video URL</p>
            <span>YouTube, TikTok, Instagram, Twitter/X, Vimeo, ...</span>
          </div>
        )}
      </div>

      {/* Format selection dialog */}
      {formatDialog && (
        <FormatDialog
          videoInfo={formatDialog.info}
          onSelect={handleFormatSelect}
          onCancel={() => setFormatDialog(null)}
        />
      )}
    </div>
  );
}
