// Video page URL identification shared by the Media download surfaces:
// URL parsing, platform detection, stable download keys and the YouTube
// oEmbed preview that works without the Native Helper.

export interface VideoUrlPreviewMetadata {
  url: string;
  downloadKey: string;
  title: string;
  thumbnail: string;
  channel: string;
  platform: string;
  durationSeconds: number;
}

export const DOWNLOAD_PLATFORM_LABELS: Record<string, string> = {
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

const YOUTUBE_VIDEO_ID_PATTERNS = [
  /(?:youtube\.com\/(?:watch\?(?:[^#\s]*&)?v=|embed\/|v\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
  /^([a-zA-Z0-9_-]{11})$/,
];

function isHttpUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseDownloadUrls(input: string): string[] {
  const matches = input.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];
  const seen = new Set<string>();
  const urls: string[] = [];

  for (const match of matches) {
    const url = match.replace(/[),.;]+$/g, '');
    if (!isHttpUrl(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    urls.push(url);
  }

  return urls;
}

export function extractVideoId(input: string): string | null {
  for (const pattern of YOUTUBE_VIDEO_ID_PATTERNS) {
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

export function createDownloadKey(url: string): string {
  const videoId = extractVideoId(url);
  if (videoId) return videoId;

  let hash = 0;
  for (let i = 0; i < url.length; i += 1) {
    hash = ((hash << 5) - hash + url.charCodeAt(i)) | 0;
  }
  return `url-${Math.abs(hash).toString(36)}`;
}

/** 16:9 crop of the 4:3 `hqdefault` still is done by the consumer (object-fit). */
export function youtubeThumbnailUrl(videoId: string, size: 'mq' | 'hq' = 'mq'): string {
  return `https://i.ytimg.com/vi/${videoId}/${size}default.jpg`;
}

export async function fetchYouTubePreviewMetadata(
  url: string,
  videoId: string,
): Promise<VideoUrlPreviewMetadata | null> {
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
      thumbnail: youtubeThumbnailUrl(videoId),
      channel: data.author_name || 'Unknown',
      platform: 'youtube',
      durationSeconds: 0,
    };
  } catch {
    return null;
  }
}
