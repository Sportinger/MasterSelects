import { plainExternalText } from './text';

interface YouTubeSearchItem {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[];
  error?: { message?: string };
}

interface YouTubeDetailsItem {
  id?: string;
  contentDetails?: { duration?: string };
  statistics?: { viewCount?: string };
}

interface YouTubeDetailsResponse {
  items?: YouTubeDetailsItem[];
  error?: { message?: string };
}

export interface YouTubeDiscoveryResult {
  id: string;
  title: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
  durationSeconds: number;
  duration: string;
  viewCount?: string;
  url: string;
}

function parseISO8601Duration(duration: string | undefined): number {
  const match = duration?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0);
}

function formatDuration(seconds: number): string {
  if (!seconds) return '?:??';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return hours > 0
    ? `${hours}:${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`
    : `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function formatViews(value: string | undefined): string | undefined {
  const count = Number(value);
  if (!Number.isFinite(count)) return undefined;
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(1)}B views`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M views`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K views`;
  return `${count} views`;
}

export function parseYouTubeDiscoveryResults(
  searchItems: YouTubeSearchItem[],
  detailItems: YouTubeDetailsItem[],
): YouTubeDiscoveryResult[] {
  const details = new Map(detailItems
    .filter((item): item is YouTubeDetailsItem & { id: string } => Boolean(item.id))
    .map((item) => [item.id, item]));

  return searchItems.flatMap((item) => {
    const id = item.id?.videoId;
    if (!id || !item.snippet) return [];
    const detail = details.get(id);
    const durationSeconds = parseISO8601Duration(detail?.contentDetails?.duration);
    return [{
      id,
      title: plainExternalText(item.snippet.title || 'Untitled video') ?? 'Untitled video',
      thumbnail: item.snippet.thumbnails?.high?.url
        || item.snippet.thumbnails?.medium?.url
        || item.snippet.thumbnails?.default?.url
        || `https://i.ytimg.com/vi/${id}/mqdefault.jpg`,
      channelTitle: plainExternalText(item.snippet.channelTitle || 'Unknown channel') ?? 'Unknown channel',
      publishedAt: item.snippet.publishedAt || '',
      durationSeconds,
      duration: formatDuration(durationSeconds),
      viewCount: formatViews(detail?.statistics?.viewCount),
      url: `https://www.youtube.com/watch?v=${id}`,
    }];
  });
}

async function readYouTubeResponse<T extends { error?: { message?: string } }>(response: Response): Promise<T> {
  const data = await response.json() as T;
  if (!response.ok) {
    throw new Error(data.error?.message || `YouTube request failed (${response.status}).`);
  }
  return data;
}

export async function searchYouTubeVideos(
  query: string,
  apiKey: string,
  signal?: AbortSignal,
  maxResults = 12,
): Promise<YouTubeDiscoveryResult[]> {
  const cleanQuery = query.trim();
  if (!cleanQuery) return [];
  if (!apiKey) throw new Error('Add a YouTube API key in Settings > Integrations for in-panel results.');

  const resultLimit = Math.min(Math.max(maxResults, 1), 20);
  const searchParams = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    maxResults: String(resultLimit),
    q: cleanQuery,
    key: apiKey,
  });
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, { signal });
  const searchData = await readYouTubeResponse<YouTubeSearchResponse>(searchResponse);
  const videoIds = (searchData.items ?? [])
    .map((item) => item.id?.videoId)
    .filter((id): id is string => Boolean(id));
  if (videoIds.length === 0) return [];

  const detailParams = new URLSearchParams({
    part: 'contentDetails,statistics',
    id: videoIds.join(','),
    key: apiKey,
  });
  const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, { signal });
  const detailData = await readYouTubeResponse<YouTubeDetailsResponse>(detailResponse);
  return parseYouTubeDiscoveryResults(searchData.items ?? [], detailData.items ?? []);
}
