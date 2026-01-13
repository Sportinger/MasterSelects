// YouTube Search Panel
// Supports YouTube Data API (with key) and direct URL paste (no key)

import { useState, useCallback, useRef } from 'react';
import { useSettingsStore } from '../../stores/settingsStore';
import { useTimelineStore } from '../../stores/timeline';
import { downloadYouTubeVideo, subscribeToDownload, type DownloadProgress } from '../../services/youtubeDownloader';
import './YouTubePanel.css';

interface YouTubeVideo {
  id: string;
  title: string;
  thumbnail: string;
  channel: string;
  duration: string;
  durationSeconds: number;
  views?: string;
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

export function YouTubePanel() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<YouTubeVideo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

  // Search using YouTube Data API
  const searchYouTubeAPI = async (searchQuery: string): Promise<YouTubeVideo[]> => {
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
    const detailsMap = new Map(detailsData.items?.map((item: any) => [item.id, item]) || []);

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

  // Main search/add handler
  const handleSearch = useCallback(async () => {
    const input = query.trim();
    if (!input) return;

    setLoading(true);
    setError(null);

    try {
      // Check if it's a YouTube URL or video ID
      const videoId = extractVideoId(input);

      if (videoId) {
        // Direct video URL/ID - get info and show it
        const videoInfo = await getVideoInfo(videoId);
        if (videoInfo) {
          setResults([videoInfo]);
        } else {
          setError('Could not load video info');
          setResults([]);
        }
      } else if (youtubeApiKey) {
        // Search query with API key
        const videos = await searchYouTubeAPI(input);
        setResults(videos);
      } else {
        // No API key and not a URL
        setError('Paste a YouTube URL, or add API key in settings for search');
        setResults([]);
      }
    } catch (err) {
      setError((err as Error).message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query, youtubeApiKey]);

  // Handle Enter key
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Open video in new tab
  const openVideo = (videoId: string) => {
    window.open(`https://www.youtube.com/watch?v=${videoId}`, '_blank');
  };

  // Copy video URL
  const copyVideoUrl = (videoId: string) => {
    navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${videoId}`);
  };

  // Drag handlers
  const handleDragStart = (e: React.DragEvent, video: YouTubeVideo) => {
    e.dataTransfer.setData('application/x-youtube-video', JSON.stringify(video));
    e.dataTransfer.effectAllowed = 'copy';
    setDraggingVideo(video.id);
  };

  const handleDragEnd = () => setDraggingVideo(null);

  // Add video to timeline
  const addVideoToTimeline = async (video: YouTubeVideo) => {
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

    const unsubscribe = subscribeToDownload(video.id, (progress: DownloadProgress) => {
      if (progress.status === 'downloading' || progress.status === 'processing') {
        updateDownloadProgress(clipId, progress.progress);
      }
    });

    try {
      const file = await downloadYouTubeVideo(video.id, video.title, video.thumbnail);
      await completeDownload(clipId, file);
    } catch (err) {
      setDownloadError(clipId, (err as Error).message);
    } finally {
      activeDownloadsRef.current.delete(video.id);
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
            placeholder={youtubeApiKey ? "Search or paste URL..." : "Paste YouTube URL..."}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="youtube-search-btn"
            onClick={handleSearch}
            disabled={loading || !query.trim()}
          >
            {loading ? '...' : youtubeApiKey ? 'Search' : 'Add'}
          </button>
        </div>

        <div className="youtube-options">
          {youtubeApiKey ? (
            <span className="api-status api-active">API Key Active</span>
          ) : (
            <>
              <span className="api-status">No API Key</span>
              <button className="btn-settings-small" onClick={openSettings}>
                Add Key
              </button>
            </>
          )}
        </div>

        {!youtubeApiKey && (
          <div className="youtube-hint">
            Paste YouTube URLs to add videos. Add API key for search.
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
                className={`youtube-video-card ${draggingVideo === video.id ? 'dragging' : ''}`}
                draggable
                onDragStart={(e) => handleDragStart(e, video)}
                onDragEnd={handleDragEnd}
                onClick={() => openVideo(video.id)}
              >
                <div className="video-thumbnail">
                  <img src={video.thumbnail} alt={video.title} loading="lazy" draggable={false} />
                  <span className="video-duration">{video.duration}</span>
                  <button
                    className="btn-copy-url"
                    onClick={(e) => { e.stopPropagation(); copyVideoUrl(video.id); }}
                    title="Copy URL"
                  >
                    Copy
                  </button>
                  <button
                    className="btn-add-timeline"
                    onClick={(e) => { e.stopPropagation(); addVideoToTimeline(video); }}
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
              </div>
            ))}
          </div>
        ) : (
          <div className="youtube-empty">
            <span className="youtube-icon">YouTube</span>
            {youtubeApiKey ? (
              <>
                <p>Search for videos</p>
                <span>Or paste a YouTube URL</span>
              </>
            ) : (
              <>
                <p>Paste a YouTube URL</p>
                <span>e.g. youtube.com/watch?v=...</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
