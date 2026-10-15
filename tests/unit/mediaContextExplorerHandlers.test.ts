import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/projectDB', () => ({
  projectDB: {
    getStoredHandle: vi.fn(),
  },
}));

vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    getFileFromRaw: vi.fn(),
    isProjectOpen: vi.fn(),
  },
}));

import {
  canDownloadMediaFileInBrowser,
  downloadMediaFileInBrowser,
} from '../../src/components/panels/media/context/useMediaContextExplorerHandlers';
import { projectDB } from '../../src/services/projectDB';
import { projectFileService } from '../../src/services/projectFileService';

const originalCreateObjectUrl = URL.createObjectURL;
const originalRevokeObjectUrl = URL.revokeObjectURL;

function restoreUrlApis(): void {
  if (originalCreateObjectUrl) {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: originalCreateObjectUrl,
    });
  } else {
    delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  }

  if (originalRevokeObjectUrl) {
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: originalRevokeObjectUrl,
    });
  } else {
    delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  }
}

function installUrlSpies(objectUrl = 'blob:media-download') {
  const createObjectUrl = vi.fn(() => objectUrl);
  const revokeObjectUrl = vi.fn();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeObjectUrl,
  });

  return {
    createObjectUrl,
    revokeObjectUrl,
  };
}

describe('downloadMediaFileInBrowser', () => {
  beforeEach(() => {
    vi.mocked(projectDB.getStoredHandle).mockResolvedValue(null);
    vi.mocked(projectFileService.getFileFromRaw).mockResolvedValue(null);
    vi.mocked(projectFileService.isProjectOpen).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreUrlApis();
    document.body.innerHTML = '';
  });

  it('downloads an in-memory file through an object URL and revokes it', async () => {
    const urls = installUrlSpies();
    const file = new File(['video'], 'Clip.mp4', { type: 'video/mp4' });
    let clickedHref = '';
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    await expect(downloadMediaFileInBrowser({
      file,
      hasFileHandle: false,
      id: 'media-1',
      name: 'Clip.mp4',
      projectPath: undefined,
      url: '',
    })).resolves.toBe(true);

    expect(urls.createObjectUrl).toHaveBeenCalledWith(file);
    expect(clickedHref).toBe('blob:media-download');
    expect(clickedDownload).toBe('Clip.mp4');
    expect(urls.revokeObjectUrl).toHaveBeenCalledWith('blob:media-download');
  });

  it('falls back to the stored media URL when the File is not hydrated', async () => {
    const urls = installUrlSpies();
    let clickedHref = '';
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    await expect(downloadMediaFileInBrowser({
      file: undefined,
      hasFileHandle: false,
      id: 'media-2',
      name: 'Proxy.wav',
      projectPath: undefined,
      url: 'blob:stored-media',
    })).resolves.toBe(true);

    expect(urls.createObjectUrl).not.toHaveBeenCalled();
    expect(clickedHref).toBe('blob:stored-media');
    expect(clickedDownload).toBe('Proxy.wav');
    expect(urls.revokeObjectUrl).not.toHaveBeenCalled();
  });

  it('resolves a project RAW file before falling back to the stored URL', async () => {
    vi.mocked(projectFileService.isProjectOpen).mockReturnValue(true);
    const urls = installUrlSpies();
    const file = new File(['raw-video'], 'Raw Clip.mp4', { type: 'video/mp4' });
    vi.mocked(projectFileService.getFileFromRaw).mockResolvedValue({ file });
    let clickedHref = '';
    let clickedDownload = '';
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedHref = this.href;
      clickedDownload = this.download;
    });

    await expect(downloadMediaFileInBrowser({
      file: undefined,
      hasFileHandle: false,
      id: 'media-3',
      name: 'Timeline Clip.mp4',
      projectPath: 'Raw/Timeline Clip.mp4',
      url: 'blob:stale-media-url',
    })).resolves.toBe(true);

    expect(projectFileService.getFileFromRaw).toHaveBeenCalledWith('Raw/Timeline Clip.mp4');
    expect(urls.createObjectUrl).toHaveBeenCalledWith(file);
    expect(clickedHref).toBe('blob:media-download');
    expect(clickedDownload).toBe('Timeline Clip.mp4');
    expect(urls.revokeObjectUrl).toHaveBeenCalledWith('blob:media-download');
  });

  it.each(['NotFoundError', 'NotAllowedError'])('handles an asynchronously rejected file read (%s)', async name => {
    const urls = installUrlSpies();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(projectDB.getStoredHandle).mockResolvedValue({
      kind: 'file', queryPermission: vi.fn().mockResolvedValue('granted'),
      getFile: vi.fn().mockRejectedValue(new DOMException('Source unavailable', name)),
    } as unknown as FileSystemFileHandle);
    const item = { id: 'missing', name: 'Missing.mp4', hasFileHandle: true, url: '' };

    await expect(downloadMediaFileInBrowser(item)).resolves.toBe(false);
    expect(click).not.toHaveBeenCalled();
    await expect(downloadMediaFileInBrowser({ ...item, url: 'blob:retained' })).resolves.toBe(true);
    expect(click).toHaveBeenCalledOnce();
    expect(urls.createObjectUrl).not.toHaveBeenCalled();
  });

  it('tries the retained file handle after a project read fails', async () => {
    const urls = installUrlSpies();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    vi.mocked(projectFileService.isProjectOpen).mockReturnValue(true);
    vi.mocked(projectFileService.getFileFromRaw).mockRejectedValue(new DOMException('Missing directory', 'NotFoundError'));
    const file = new File(['audio'], 'Retained.wav');
    vi.mocked(projectDB.getStoredHandle).mockResolvedValue({
      kind: 'file', queryPermission: vi.fn().mockResolvedValue('granted'), getFile: vi.fn().mockResolvedValue(file),
    } as unknown as FileSystemFileHandle);
    await expect(downloadMediaFileInBrowser({
      id: 'retained', name: file.name, hasFileHandle: true, projectPath: 'Raw/Retained.wav', url: '',
    })).resolves.toBe(true);
    expect(urls.createObjectUrl).toHaveBeenCalledWith(file);
  });

  it('marks project-backed and handle-backed media as browser-downloadable', () => {
    expect(canDownloadMediaFileInBrowser({
      file: undefined,
      hasFileHandle: false,
      projectPath: 'Raw/Clip.mp4',
      url: '',
    })).toBe(true);
    expect(canDownloadMediaFileInBrowser({
      file: undefined,
      hasFileHandle: true,
      projectPath: undefined,
      url: '',
    })).toBe(true);
  });
});
