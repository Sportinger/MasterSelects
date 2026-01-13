// YouTube video downloader service
// Uses multiple backends to find a working download source

// Cobalt API instances (some community instances may have CORS enabled)
const COBALT_INSTANCES = [
  'https://api.cobalt.tools',
  'https://co.eepy.today',
  'https://cobalt.api.timelessnesses.me',
];

// Alternative: use saveservall API (has CORS support)
const SAVESERVALL_API = 'https://api.saveservall.xyz/download';

// For download URLs that need CORS proxy
const DOWNLOAD_PROXY = 'https://corsproxy.io/?';

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
    // Request video URL from download APIs
    progress.status = 'downloading';
    progress.progress = 10;
    notifySubscribers(progress);

    const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
    let downloadUrl: string | null = null;
    let lastError: Error | null = null;

    // Method 1: Try Cobalt instances
    for (const instance of COBALT_INSTANCES) {
      try {
        console.log(`[YouTubeDownloader] Trying Cobalt: ${instance}...`);
        const response = await fetch(instance, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          body: JSON.stringify({
            url: youtubeUrl,
            videoQuality: '720',
            filenameStyle: 'basic',
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.url) {
            downloadUrl = data.url;
            console.log(`[YouTubeDownloader] Cobalt success: ${instance}`);
            break;
          } else if (data.status === 'picker' && data.picker?.[0]?.url) {
            downloadUrl = data.picker[0].url;
            console.log(`[YouTubeDownloader] Cobalt picker success: ${instance}`);
            break;
          } else if (data.status === 'error') {
            lastError = new Error(data.text || 'Cobalt error');
          }
        }
      } catch (e) {
        console.log(`[YouTubeDownloader] Cobalt failed: ${instance}`, (e as Error).message);
        lastError = e as Error;
      }
    }

    // Method 2: Try SaveServAll API (has CORS)
    if (!downloadUrl) {
      try {
        console.log('[YouTubeDownloader] Trying SaveServAll API...');
        const response = await fetch(SAVESERVALL_API, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            url: youtubeUrl,
            quality: '720p',
          }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.url || data.download_url) {
            downloadUrl = data.url || data.download_url;
            console.log('[YouTubeDownloader] SaveServAll success');
          }
        }
      } catch (e) {
        console.log('[YouTubeDownloader] SaveServAll failed:', (e as Error).message);
        lastError = e as Error;
      }
    }

    // Method 3: Try y2mate-style API via CORS proxy
    if (!downloadUrl) {
      try {
        console.log('[YouTubeDownloader] Trying fallback API...');
        // Use a simple video info API that might work
        const infoUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(youtubeUrl)}&format=json`;
        const infoResponse = await fetch(infoUrl);
        if (infoResponse.ok) {
          // oEmbed works but doesn't give download URL
          // At this point we need to inform user to use external tool
          throw new Error('Browser download blocked. Use yt-dlp or cobalt.tools directly.');
        }
      } catch (e) {
        if ((e as Error).message.includes('Browser download')) {
          throw e;
        }
        lastError = e as Error;
      }
    }

    if (!downloadUrl) {
      throw new Error(
        lastError?.message ||
        'Download service unavailable. Try using cobalt.tools or yt-dlp directly.'
      );
    }

    progress.progress = 30;
    notifySubscribers(progress);

    // Download the video file (try direct, then with CORS proxy)
    let videoResponse: Response | null = null;

    try {
      console.log('[YouTubeDownloader] Downloading from:', downloadUrl.substring(0, 50) + '...');
      videoResponse = await fetch(downloadUrl);
      if (!videoResponse.ok) {
        videoResponse = null;
      }
    } catch {
      console.log('[YouTubeDownloader] Direct download failed, trying CORS proxy...');
    }

    // Try CORS proxy for download if direct failed
    if (!videoResponse) {
      const proxyDownloadUrl = DOWNLOAD_PROXY + encodeURIComponent(downloadUrl);
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
