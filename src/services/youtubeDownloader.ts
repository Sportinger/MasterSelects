// YouTube video downloader service using Cobalt API
// Cobalt is a free API that extracts video URLs from YouTube and other platforms

const COBALT_API = 'https://api.cobalt.tools/api/json';

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

    const response = await fetch(COBALT_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${videoId}`,
        vCodec: 'h264',  // Most compatible
        vQuality: '720', // Good quality, reasonable size
        aFormat: 'mp3',
        isAudioOnly: false,
        filenamePattern: 'basic',
      }),
    });

    if (!response.ok) {
      throw new Error(`Cobalt API error: ${response.status}`);
    }

    const data = await response.json();

    if (data.status === 'error') {
      throw new Error(data.text || 'Failed to get video URL');
    }

    if (data.status === 'rate-limit') {
      throw new Error('Rate limited. Please try again in a few seconds.');
    }

    // Get the download URL
    const downloadUrl = data.url;
    if (!downloadUrl) {
      throw new Error('No download URL received');
    }

    progress.progress = 30;
    notifySubscribers(progress);

    // Download the video file
    const videoResponse = await fetch(downloadUrl);

    if (!videoResponse.ok) {
      throw new Error(`Failed to download video: ${videoResponse.status}`);
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
