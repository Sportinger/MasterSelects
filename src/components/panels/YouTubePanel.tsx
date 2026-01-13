// YouTube Search Panel
// Supports both Invidious (no API key) and YouTube Data API
// Drag videos to timeline to download and add them

import { useState, useCallback, useRef } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';
import { downloadYouTubeVideo, subscribeToDownload, type DownloadProgress } from '../../services/youtubeDownloader';
import './YouTubePanel.css';

// Invidious instances (fallback, no API key needed)
const INVIDIOUS_INSTANCES = [
  'https://inv.nadeko.net',
  'https://invidious.nerdvpn.de',
  'https://invidious.privacyredirect.com',
  'https://invidious.protokolla.fi',
];

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: string;
  duration: string;
  durationSeconds: number;
  views?: string;
}

type SearchProvider = 'invidious' | 'youtube-api';

export function YouTubePanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<SearchProvider>('invidious');
  const [draggingVideo, setDraggingVideo] = useState<string | null>(null);

  const { apiKeys, openSettings } = useSettingsStore();
  const youtubeApiKey = apiKeys.youtube || '';

  // Timeline store actions
  const addPendingDownloadClip = useTimelineStore(s => s.addPendingDownloadClip);
  const updateDownloadProgress = useTimelineStore(s => s.updateDownloadProgress);
  const completeDownload = useTimelineStore(s => s.completeDownload);
  const setDownloadError = useTimelineStore(s => s.setDownloadError);
  const tracks = useTimelineStore(s => s.tracks);
  const playheadPosition = useTimelineStore(s => s.playheadPosition);

  // Track active downloads to prevent duplicates
  const activeDownloadsRef = useRef<Set<string>>(new Set());

  // Format duration from seconds to MM:SS or HH:MM:SS
  const formatDuration = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Parse ISO 8601 duration (PT1H2M3S) to seconds
  const parseISO8601Duration = (duration: string): number => {
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const hours = parseInt(match[1] || '0');
    const minutes = parseInt(match[2] || '0');
    const seconds = parseInt(match[3] || '0');
    return hours * 3600 + minutes * 60 + seconds;
  };

  // Format view count
  const formatViews = (count: number): string => {
    if (count >= 1000000) {
      return `${(count / 1000000).toFixed(1)}M views`;
    }
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1)}K views`;
    }
    return `${count} views`;
  };

  // Search using Invidious API
  const searchInvidious = async (searchQuery: string): Promise<YouTubeVideo[]> => {
    let lastError: Error | null = null;

    for (const instance of INVIDIOUS_INSTANCES) {
      try {
        const response = await fetch(
          `${instance}/api/v1/search?q=${encodeURIComponent(searchQuery)}&type=video`,
          { signal: AbortSignal.timeout(10000) }
        );

        if (!response.ok) continue;

        const data = await response.json();

        return data
          .filter((item: any) => item.type === 'video')
          .slice(0, 20)
          .map((item: any) => ({
            id: item.videoId,
            title: item.title,
            thumbnail: item.videoThumbnails?.find((t: any) => t.quality === 'medium')?.url
              || item.videoThumbnails?.[0]?.url
              || `https://i.ytimg.com/vi/${item.videoId}/mqdefault.jpg`,
            channel: item.author,
            durationSeconds: item.lengthSeconds || 0,
            duration: formatDuration(item.lengthSeconds || 0),
            views: item.viewCount ? formatViews(item.viewCount) : undefined,
          }));
      } catch (err) {
        lastError = err as Error;
        continue;
      }
    }

    throw lastError || new Error('All Invidious instances failed');
  };

  // Search using YouTube Data API
  const searchYouTubeAPI = async (searchQuery: string): Promise<YouTubeVideo[]> => {
    if (!youtubeApiKey) {
      throw new Error('YouTube API key not configured');
    }

    // First, search for videos
    const searchResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=20&q=${encodeURIComponent(searchQuery)}&key=${youtubeApiKey}`
    );

    if (!searchResponse.ok) {
      const errorData = await searchResponse.json();
      throw new Error(errorData.error?.message || 'YouTube API error');
    }

    const searchData = await searchResponse.json();
    const videoIds = searchData.items.map((item: any) => item.id.videoId).join(',');

    // Get video details (duration, views)
    const detailsResponse = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,statistics&id=${videoIds}&key=${youtubeApiKey}`
    );

    const detailsData = await detailsResponse.json();
    const detailsMap = new Map(
      detailsData.items?.map((item: any) => [item.id, item]) || []
    );

    return searchData.items.map((item: any) => {
      const details = detailsMap.get(item.id.videoId) as any;
      const durationSeconds = details?.contentDetails?.duration
        ? parseISO8601Duration(details.contentDetails.duration)
        : 0;
      return {
        id: item.id.videoId,
        title: item.snippet.title,
        thumbnail: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url,
        channel: item.snippet.channelTitle,
        durationSeconds,
        duration: formatDuration(durationSeconds),
        views: details?.statistics?.viewCount
          ? formatViews(parseInt(details.statistics.viewCount))
          : undefined,
      };
    });
  };

  // Main search handler
  const handleSearch = useCallback(async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      let videos: YouTubeVideo[];

      if (provider === 'youtube-api' && youtubeApiKey) {
        videos = await searchYouTubeAPI(query);
      } else {
        videos = await searchInvidious(query);
      }

      setResults(videos);
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, provider, youtubeApiKey]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch();
    }
  };

  // Open video in new tab
  const openVideo = (videoId: string) => {
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
  };

  // Copy video URL to clipboard
  const copyVideoUrl = (videoId: string) => {
    navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
  };

  // Handle drag start
  const handleDragStart = (e: React.DragEvent, video: YouTubeVideo) => {
    e.dataTransfer.setData('application/x-youtube-video', JSON.stringify(video));
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingVideo(video.id);
  };

  // Handle drag end
  const handleDragEnd = () => {
    setDraggingVideo(null);
  };

  // Start download and add to timeline
  const addVideoToTimeline = async (video: YouTubeVideo) => {
    // Check if already downloading
    if (activeDownloadsRef.current.has(video.id)) {
      console.log('[YouTube] Already downloading:', video.id);
      return;
    }

    // Find first video track
    const videoTrack = tracks.find(t => t.type === 'video');
    if (!videoTrack) {
      setError('No video track available');
      return;
    }

    // Add pending clip to timeline
    const clipId = addPendingDownloadClip(
      videoTrack.id,
      playheadPosition,
      video.id,
      video.title,
      video.thumbnail,
      video.durationSeconds || 30
    );

    if (!clipId) {
      setError('Failed to add clip to timeline');
      return;
    }

    activeDownloadsRef.current.add(video.id);

    // Subscribe to download progress
    const unsubscribe = subscribeToDownload(video.id, (progress: DownloadProgress) => {
      if (progress.status === 'downloading' || progress.status === 'processing') {
        updateDownloadProgress(clipId, progress.progress);
      }
    });

    try {
      // Start download
      const file = await downloadYouTubeVideo(video.id, video.title, video.thumbnail);

      // Complete the download - replace pending clip with actual video
      await completeDownload(clipId, file);

      console.log('[YouTube] Download complete:', video.title);
    } catch (err) {
      console.error('[YouTube] Download failed:', err);
      setDownloadError(clipId, (err as Error).message);
    } finally {
      activeDownloadsRef.current.delete(video.id);
      unsubscribe();
    }
  };

  return (
    <div className="youtube-panel">
      {/* Header with provider selection */}
      <div className="youtube-header">
        <div className="youtube-search-row">
          <input
            type="text"
            className="youtube-search-input"
            placeholder="Search YouTube..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="youtube-search-btn"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? '...' : 'Search'}
          </button>
        </div>

        <div className="youtube-options">
          <select
            className="provider-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value as SearchProvider)}
          >
            <option value="invidious">Invidious (No API Key)</option>
            <option value="youtube-api" disabled={!youtubeApiKey}>
              YouTube API {!youtubeApiKey && '(No Key)'}
            </option>
          </select>

          {provider === 'youtube-api' && !youtubeApiKey && (
            <button className="btn-settings-small" onClick={openSettings}>
              Add API Key
            </button>
          )}
        </div>

        <div className="youtube-drag-hint">
          Drag videos to timeline to download
        </div>
      </div>

      {/* Error message */}
      {error && (
        <div className="youtube-error">
          <span className="error-icon">!</span>
          {error}
        </div>
      )}

      {/* Results */}
      <div className="youtube-results">
        {loading ? (
          <div className="youtube-loading">
            <div className="loading-spinner" />
            <span>Searching...</span>
          </div>
        ) : results.length > 0 ? (
          <div className="youtube-grid">
            {results.map((video) => (
              <div
                key={video.id}
                className={`youtube-video-card ${draggingVideo === video.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, video)}
                onDragEnd={handleDragEnd}
                onClick={() => openVideo(video.id)}
              >
                <div className="video-thumbnail">
                  <img
                    src={video.thumbnail}
                    alt={video.title}
                    loading="lazy"
                    draggable={false}
                  />
                  <span className="video-duration">{video.duration}</span>
                  <button
                    className="btn-copy-url"
                    onClick={(e) => {
                      e.stopPropagation();
                      copyVideoUrl(video.id);
                    }}
                    title="Copy URL"
                  >
                    Copy
                  </button>
                  <button
                    className="btn-add-timeline"
                    onClick={(e) => {
                      e.stopPropagation();
                      addVideoToTimeline(video);
                    }}
                    title="Add to timeline"
                  >
                    +
                  </button>
                </div>
                <div className="video-info">
                  <h4 className="video-title">{video.title}</h4>
                  <span className="video-channel">{video.channel}</span>
                  {video.views && <span className="video-views">{video.views}</span>}
                </div>
                <div className="drag-hint">
                  <span>Drag to timeline</span>
                </div>
              </div>
            ))}
          </div>
        ) : query && !loading ? (
          <div className="youtube-empty">
            <p>No results found</p>
            <span>Try a different search term</span>
          </div>
        ) : (
          <div className="youtube-empty">
            <span className="youtube-icon">YouTube</span>
            <p>Search for videos</p>
            <span>Drag results to timeline to download</span>
          </div>
        )}
      </div>
    </div>
  );
}
