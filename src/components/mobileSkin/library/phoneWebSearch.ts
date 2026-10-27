// Web sources of the phone Library: search URLs of the platforms the desktop Discover panel offers,
// an in-app YouTube search with the user's own YouTube Data API key (the same key and endpoint the
// desktop uses), and the honest limits of downloading on a phone.

export type PhoneWebPlatform = 'youtube' | 'instagram' | 'tiktok';

export const PHONE_WEB_PLATFORMS: ReadonlyArray<{ id: PhoneWebPlatform; label: string }> = [
  { id: 'youtube', label: 'YouTube' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'tiktok', label: 'TikTok' },
];

export const PHONE_WEB_LIMITS = {
  download: 'Downloading from a web address needs yt-dlp and the native helper, desktop programs a phone browser cannot run (and the browser may not read other sites’ cookies). Save the video with the platform’s own app or your browser, then tap Import a downloaded file. Or copy the link and download it in the full editor on a computer.',
  helperDownloads: 'The download queue of the full editor runs through the native helper, a desktop program. Files you already downloaded and imported stay in the Library and work here.',
} as const;

export function phonePlatformSearchUrl(platform: PhoneWebPlatform, query: string): string {
  const q = encodeURIComponent(query.trim());
  switch (platform) {
    case 'youtube': return `https://www.youtube.com/results?search_query=${q}`;
    case 'instagram': return `https://www.instagram.com/explore/search/keyword/?q=${q}`;
    case 'tiktok': return `https://www.tiktok.com/search?q=${q}`;
  }
}

/** A web address the user pasted, normalized; null when it is not an http(s) URL. */
export function parsePhoneWebUrl(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export interface PhoneYouTubeResult { id: string; title: string; channel: string; thumbnail: string; url: string }

interface SearchResponse {
  items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string }; default?: { url?: string } } } }>;
  error?: { message?: string };
}

/** Searches YouTube with the Data API v3 key; throws with the API's own message on failure. */
export async function searchPhoneYouTube(query: string, apiKey: string, fetcher: typeof fetch = fetch, maxResults = 12): Promise<PhoneYouTubeResult[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${maxResults}&q=${encodeURIComponent(query.trim())}&key=${encodeURIComponent(apiKey)}`;
  const response = await fetcher(url);
  let body: SearchResponse = {};
  try { body = await response.json() as SearchResponse; } catch { /* the status below explains it */ }
  if (!response.ok) throw new Error(body.error?.message || `YouTube answered ${response.status}`);
  return (body.items ?? []).flatMap((item) => {
    const id = item.id?.videoId;
    if (!id) return [];
    return [{
      id,
      title: item.snippet?.title ?? id,
      channel: item.snippet?.channelTitle ?? '',
      thumbnail: item.snippet?.thumbnails?.medium?.url ?? item.snippet?.thumbnails?.default?.url ?? '',
      url: `https://www.youtube.com/watch?v=${id}`,
    }];
  });
}
