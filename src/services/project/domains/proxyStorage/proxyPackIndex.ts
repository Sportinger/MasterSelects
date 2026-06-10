// Proxy frame pack index — JPEG pack file naming, index schema, normalize/read/write

export const PROXY_PACK_INDEX_FILE_NAME = 'frames.index.json';
const PROXY_PACK_FILE_PREFIX = 'frames_';
const PROXY_PACK_FILE_EXTENSION = 'pack';
export const PROXY_PACK_FILE_MATCH = /^frames_(\d+)\.pack$/i;
const PROXY_PACK_INDEX_VERSION = 1;
export const PROXY_PACK_MAX_BYTES = 128 * 1024 * 1024;
export const PROXY_PACK_FRAME_MIME_TYPE = 'image/jpeg';

export function getProxyPackFileName(packIndex: number): string {
  return `${PROXY_PACK_FILE_PREFIX}${packIndex.toString().padStart(4, '0')}.${PROXY_PACK_FILE_EXTENSION}`;
}

export interface ProxyPackFrameIndexEntry {
  frameIndex: number;
  pack: string;
  offset: number;
  size: number;
  mimeType?: string;
}

export interface ProxyPackFileEntry {
  name: string;
  byteLength: number;
  frameCount: number;
}

interface ProxyPackIndexFile {
  version: typeof PROXY_PACK_INDEX_VERSION;
  format: 'jpeg-pack';
  mediaId: string;
  updatedAt: number;
  packs: ProxyPackFileEntry[];
  frames: ProxyPackFrameIndexEntry[];
}

export interface ProxyPackRuntimeIndex {
  file: ProxyPackIndexFile;
  frameMap: Map<number, ProxyPackFrameIndexEntry>;
  packMap: Map<string, ProxyPackFileEntry>;
}

export function createEmptyPackIndex(mediaId: string): ProxyPackRuntimeIndex {
  const file: ProxyPackIndexFile = {
    version: PROXY_PACK_INDEX_VERSION,
    format: 'jpeg-pack',
    mediaId,
    updatedAt: Date.now(),
    packs: [],
    frames: [],
  };

  return {
    file,
    frameMap: new Map(),
    packMap: new Map(),
  };
}

function normalizePackIndex(raw: unknown, mediaId: string): ProxyPackRuntimeIndex | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<ProxyPackIndexFile>;
  if (candidate.format !== 'jpeg-pack' || candidate.version !== PROXY_PACK_INDEX_VERSION) {
    return null;
  }

  const runtime = createEmptyPackIndex(typeof candidate.mediaId === 'string' ? candidate.mediaId : mediaId);
  const rawPacks = Array.isArray(candidate.packs) ? candidate.packs : [];
  for (const pack of rawPacks) {
    if (
      pack &&
      typeof pack === 'object' &&
      typeof pack.name === 'string' &&
      PROXY_PACK_FILE_MATCH.test(pack.name) &&
      Number.isFinite(pack.byteLength) &&
      Number.isFinite(pack.frameCount)
    ) {
      const normalizedPack: ProxyPackFileEntry = {
        name: pack.name,
        byteLength: Math.max(0, Math.floor(pack.byteLength)),
        frameCount: Math.max(0, Math.floor(pack.frameCount)),
      };
      runtime.file.packs.push(normalizedPack);
      runtime.packMap.set(normalizedPack.name, normalizedPack);
    }
  }

  const rawFrames = Array.isArray(candidate.frames) ? candidate.frames : [];
  for (const frame of rawFrames) {
    if (
      frame &&
      typeof frame === 'object' &&
      Number.isInteger(frame.frameIndex) &&
      frame.frameIndex >= 0 &&
      typeof frame.pack === 'string' &&
      PROXY_PACK_FILE_MATCH.test(frame.pack) &&
      Number.isFinite(frame.offset) &&
      Number.isFinite(frame.size) &&
      frame.offset >= 0 &&
      frame.size > 0
    ) {
      const entry: ProxyPackFrameIndexEntry = {
        frameIndex: frame.frameIndex,
        pack: frame.pack,
        offset: Math.floor(frame.offset),
        size: Math.floor(frame.size),
        mimeType: typeof frame.mimeType === 'string' ? frame.mimeType : PROXY_PACK_FRAME_MIME_TYPE,
      };
      runtime.frameMap.set(entry.frameIndex, entry);
    }
  }

  runtime.file.frames = Array.from(runtime.frameMap.values()).sort((a, b) => a.frameIndex - b.frameIndex);
  runtime.file.updatedAt = Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now();
  return runtime;
}

export async function readProxyPackIndexFromFolder(
  mediaFolder: FileSystemDirectoryHandle,
  mediaId: string
): Promise<ProxyPackRuntimeIndex | null> {
  try {
    const indexHandle = await mediaFolder.getFileHandle(PROXY_PACK_INDEX_FILE_NAME);
    const indexFile = await indexHandle.getFile();
    const raw = JSON.parse(await indexFile.text()) as unknown;
    return normalizePackIndex(raw, mediaId);
  } catch {
    return null;
  }
}

export async function writeProxyPackIndex(
  mediaFolder: FileSystemDirectoryHandle,
  runtime: ProxyPackRuntimeIndex
): Promise<void> {
  runtime.file.updatedAt = Date.now();
  runtime.file.frames = Array.from(runtime.frameMap.values()).sort((a, b) => a.frameIndex - b.frameIndex);
  runtime.file.packs = runtime.file.packs.filter((pack) => pack.frameCount > 0);

  const indexHandle = await mediaFolder.getFileHandle(PROXY_PACK_INDEX_FILE_NAME, { create: true });
  const writable = await indexHandle.createWritable();
  await writable.write(JSON.stringify(runtime.file));
  await writable.close();
}

export function getNextPackOrdinal(runtime: ProxyPackRuntimeIndex): number {
  let maxOrdinal = -1;
  for (const pack of runtime.file.packs) {
    const match = pack.name.match(PROXY_PACK_FILE_MATCH);
    if (match) {
      maxOrdinal = Math.max(maxOrdinal, parseInt(match[1], 10));
    }
  }
  return maxOrdinal + 1;
}
