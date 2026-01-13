// YouTube video downloader service using Cobalt API
// Cobalt is a free API that extracts video URLs from YouTube and other platforms

// Main Cobalt API endpoint
const COBALT_API = 'https://api.cobalt.tools';

// CORS proxies to try (in order of preference)
const CORS_PROXIES = [
  (url: string) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url: string) => `https://proxy.cors.sh/${url}`,
];

export interface DownloadProgress {
  videoId: string;
  status: 'pending' | 'downloading' | 'processing' | 'complete' | 'error';
  progress: number; // 0-100
  error?: string;
  file?: File;
  title: string;
  thumbnail: string;
}

export type DownloadCallback = (progress: DownloadProgress) => void;

// Active downloads map
const activeDownloads = new Map<string, DownloadProgress>();
const downloadCallbacks = new Map<string, Set<DownloadCallback>>();

// Subscribe to download updates
export function subscribeToDownload(videoId: string, callback: DownloadCallback): () => void {
  if (!downloadCallbacks.has(videoId)) {
    downloadCallbacks.set(videoId, new Set());
  }
  downloadCallbacks.get(videoId)!.add(callback);

  // Immediately send current status if exists
  const current = activeDownloads.get(videoId);
  if (current) {
    callback(current);
  }

  // Return unsubscribe function
  return () => {
    downloadCallbacks.get(videoId)?.delete(callback);
  };
}

// Notify all subscribers of a download
function notifySubscribers(progress: DownloadProgress) {
  activeDownloads.set(progress.videoId, progress);
  downloadCallbacks.get(progress.videoId)?.forEach(cb => cb(progress));
}

// Get download status
export function getDownloadStatus(videoId: string): DownloadProgress | undefined {
  return activeDownloads.get(videoId);
}

// Download video from YouTube using Cobalt API
export async function downloadYouTubeVideo(
  videoId: string,
  title: string,
  thumbnail: string,
  onProgress?: DownloadCallback
): Promise<File> {
  // Check if already downloading
  const existing = activeDownloads.get(videoId);
  if (existing && existing.status === 'downloading') {
    throw new Error('Video is already downloading');
  }

  // Subscribe to updates if callback provided
  if (onProgress) {
    subscribeToDownload(videoId, onProgress);
  }

  const progress: DownloadProgress = {
    videoId,
    status: 'pending',
    progress: 0,
    title,
    thumbnail,
  };

  notifySubscribers(progress);

  try {
    // Request video URL from Cobalt
    progress.status = 'downloading';
    progress.progress = 10;
    notifySubscribers(progress);

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Cobalt API v7 request body
    const requestBody = JSON.stringify({
      url: youtubeUrl,
      videoQuality: '720',
      filenameStyle: 'basic',
    });

    let data: any = null;
    let lastError: Error | null = null;

    // Try direct API first (works if CORS is disabled or in Electron)
    try {
      console.log('[YouTubeDownloader] Trying direct Cobalt API...');
      const response = await fetch(COBALT_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: requestBody,
      });

      if (response.ok) {
        data = await response.json();
        console.log('[YouTubeDownloader] Direct API success');
      }
    } catch (e) {
      lastError = e as Error;
      console.log('[YouTubeDownloader] Direct API failed (CORS):', (e as Error).message);
    }

    // Try CORS proxies
    if (!data || data.status === 'error') {
      for (let i = 0; i < CORS_PROXIES.length; i++) {
        const proxyFn = CORS_PROXIES[i];
        const proxyUrl = proxyFn(COBALT_API);
        console.log(`[YouTubeDownloader] Trying CORS proxy ${i + 1}...`);

        try {
          const response = await fetch(proxyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json',
            },
            body: requestBody,
          });

          if (response.ok) {
            const text = await response.text();
            try {
              data = JSON.parse(text);
              if (data.url || data.status === 'tunnel' || data.status === 'redirect') {
                console.log(`[YouTubeDownloader] CORS proxy ${i + 1} success`);
                break;
              }
            } catch {
              // Response wasn't JSON, try next proxy
            }
          }
        } catch (e) {
          lastError = e as Error;
          console.log(`[YouTubeDownloader] CORS proxy ${i + 1} failed:`, (e as Error).message);
        }
      }
    }

    if (!data) {
      throw lastError || new Error('Could not connect to download service. Try again later.');
    }

    if (data.status === 'error') {
      throw new Error(data.text || data.error?.code || 'Failed to get video URL');
    }

    if (data.status === 'rate-limit') {
      throw new Error('Rate limited. Please try again in a few seconds.');
    }

    // Get the download URL (API v7 format)
    let downloadUrl = data.url || data.audio;

    // Check for picker response (multiple quality options)
    if (!downloadUrl && data.status === 'picker' && data.picker?.length > 0) {
      // Find best video option (prefer mp4)
      const videoOption = data.picker.find((p: any) => p.type === 'video') || data.picker[0];
      downloadUrl = videoOption?.url;
    }

    // Handle tunnel/redirect (direct stream URLs)
    if (!downloadUrl && (data.status === 'tunnel' || data.status === 'redirect')) {
      downloadUrl = data.url;
    }

    if (!downloadUrl) {
      console.log('[YouTubeDownloader] Response data:', data);
      throw new Error('No download URL in response');
    }

    progress.progress = 30;
    notifySubscribers(progress);

    // Download the video file (try direct, then with CORS proxy)
    let videoResponse: Response | null = null;

    try {
      videoResponse = await fetch(downloadUrl);
      if (!videoResponse.ok) {
        videoResponse = null;
      }
    } catch {
      console.log('[YouTubeDownloader] Direct download failed, trying CORS proxy...');
    }

    // Try CORS proxy for download if direct failed
    if (!videoResponse) {
      const proxyDownloadUrl = CORS_PROXIES[0](downloadUrl);
      videoResponse = await fetch(proxyDownloadUrl);
    }

    if (!videoResponse || !videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse?.status || 'no response'}`);
    }

    // Get content length for progress tracking
    const contentLength = videoResponse.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength) : 0;

    progress.status = 'processing';
    progress.progress = 40;
    notifySubscribers(progress);

    // Read the response as a stream if supported, otherwise as blob
    let blob: Blob;

    if (videoResponse.body && totalBytes > 0) {
      const reader = videoResponse.body.getReader();
      const chunks: Uint8Array[] = [];
      let receivedBytes = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedBytes += value.length;

        // Update progress (40% to 90% during download)
        const downloadProgress = (receivedBytes / totalBytes) * 50;
        progress.progress = Math.min(90, 40 + downloadProgress);
        notifySubscribers(progress);
      }

      blob = new Blob(chunks as BlobPart[], { type: 'video/mp4' });
    } else {
      // Fallback: load entire blob at once
      blob = await videoResponse.blob();
      progress.progress = 90;
      notifySubscribers(progress);
    }

    // Create File object
    const sanitizedTitle = title.replace(/[^a-zA-Z0-9\s-]/g, '').substring(0, 100);
    const file = new File([blob], `${sanitizedTitle}.mp4`, { type: 'video/mp4' });

    progress.status = 'complete';
    progress.progress = 100;
    progress.file = file;
    notifySubscribers(progress);

    return file;
  } catch (error) {
    progress.status = 'error';
    progress.error = (error as Error).message;
    notifySubscribers(progress);
    throw error;
  }
}

// Cancel a download (not really possible with fetch, but marks it as cancelled)
export function cancelDownload(videoId: string) {
  const progress = activeDownloads.get(videoId);
  if (progress && progress.status === 'downloading') {
    progress.status = 'error';
    progress.error = 'Download cancelled';
    notifySubscribers(progress);
  }
}

// Clear completed/errored downloads from memory
export function clearDownload(videoId: string) {
  activeDownloads.delete(videoId);
  downloadCallbacks.delete(videoId);
}

// Get all active downloads
export function getActiveDownloads(): DownloadProgress[] {
  return Array.from(activeDownloads.values()).filter(
    d => d.status === 'pending' || d.status === 'downloading' || d.status === 'processing'
  );
}
