import type { Command, NativeVideoSearchResult, VideoInfo } from './protocol';
import type {
  NativeHelperCommandHost,
  ProgressLikeResponse,
} from './nativeHelperClientTypes';
import { getErrorMessage, okField } from './nativeHelperResponseUtils';

export async function listFormats(
  host: NativeHelperCommandHost,
  url: string,
): Promise<VideoInfo | null> {
  const id = host.nextId();

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      resolve(null);
    }, 30000);

    host.registerPendingRequest(id, (response) => {
      clearTimeout(timeout);
      if (response.ok) {
        resolve({
          title: okField<string>(response, 'title') ?? '',
          thumbnail: okField<string>(response, 'thumbnail') ?? '',
          duration: okField<number>(response, 'duration') ?? 0,
          uploader: okField<string>(response, 'uploader') ?? '',
          platform: okField<string>(response, 'platform'),
          recommendations: okField<VideoInfo['recommendations']>(response, 'recommendations') ?? [],
          allFormats: okField<VideoInfo['allFormats']>(response, 'allFormats') ?? [],
        });
      } else {
        resolve(null);
      }
    });

    const cmd = {
      cmd: 'list_formats',
      id,
      url,
    };

    host.sendRaw(JSON.stringify(cmd)).catch(() => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      resolve(null);
    });
  });
}

export async function searchVideos(
  host: NativeHelperCommandHost,
  query: string,
  maxResults = 12,
): Promise<NativeVideoSearchResult[]> {
  const id = host.nextId();
  const response = await host.send({
    cmd: 'search_videos',
    id,
    query,
    max_results: Math.min(Math.max(maxResults, 1), 20),
  }, 45000);
  if (!response.ok) {
    throw new Error(getErrorMessage(response, 'Native Helper search failed'));
  }
  return okField<NativeVideoSearchResult[]>(response, 'results') ?? [];
}

export async function downloadYouTube(
  host: NativeHelperCommandHost,
  url: string,
  formatId?: string,
  onProgress?: (percent: number, speed?: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  return downloadWithCommand(host, 'download_youtube', url, formatId, onProgress);
}

export async function download(
  host: NativeHelperCommandHost,
  url: string,
  formatId?: string,
  onProgress?: (percent: number, speed?: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  return downloadWithCommand(host, 'download', url, formatId, onProgress);
}

async function downloadWithCommand(
  host: NativeHelperCommandHost,
  cmdName: 'download_youtube' | 'download',
  url: string,
  formatId?: string,
  onProgress?: (percent: number, speed?: string) => void,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const id = host.nextId();

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      host.deletePendingRequest(id);
      host.deleteProgressCallback(id);
      reject(new Error('Download timeout'));
    }, 600000);

    if (onProgress) {
      host.setProgressCallback(id, onProgress);
    }

    host.registerPendingRequest(id, (response: ProgressLikeResponse) => {
      if (response.type === 'progress' && response.percent !== undefined) {
        const progressCb = host.getProgressCallback(id);
        if (progressCb) {
          progressCb(response.percent, response.speed);
        }
        return;
      }

      clearTimeout(timeout);
      host.deleteProgressCallback(id);
      if (response.ok) {
        resolve({
          success: true,
          path: okField<string>(response, 'path'),
        });
      } else {
        resolve({
          success: false,
          error: getErrorMessage(response, 'Download failed'),
        });
      }
    });

    const cmd = {
      cmd: cmdName,
      id,
      url,
    } as Command & { format_id?: string };

    if (formatId) {
      cmd.format_id = formatId;
    }

    host.sendRaw(JSON.stringify(cmd)).catch((err) => {
      clearTimeout(timeout);
      host.deletePendingRequest(id);
      host.deleteProgressCallback(id);
      reject(err);
    });
  });
}

export async function locateFile(
  host: NativeHelperCommandHost,
  filename: string,
  searchDirs?: string[],
): Promise<string | null> {
  const id = host.nextId();
  const cmd: Command = { cmd: 'locate', id, filename };
  if (searchDirs?.length) {
    cmd.search_dirs = searchDirs;
  }
  const response = await host.send(cmd);
  if (!response.ok) return null;
  const found = okField<boolean>(response, 'found');
  const path = okField<string>(response, 'path');
  if (found && path) {
    return path;
  }
  return null;
}
