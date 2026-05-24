const DEFAULT_BINARY_MIME = 'application/octet-stream';

export function getFileExtension(fileName: string): string {
  const match = fileName.match(/\.([^.]+)$/);
  return match?.[1]?.toLowerCase() ?? '';
}

export function normalizeMimeType(mimeType: string | undefined, fallback = DEFAULT_BINARY_MIME): string {
  const normalized = (mimeType ?? '').split(';')[0]?.trim().toLowerCase();
  return normalized || fallback;
}

export function guessMimeType(file: File, fallback = DEFAULT_BINARY_MIME): string {
  const extension = getFileExtension(file.name);
  if (extension === 'csv') return normalizeMimeType(file.type, 'text/csv');
  return normalizeMimeType(file.type, fallback);
}

export function sanitizeIdPart(value: string): string {
  const sanitized = value
    .replace(/\.[^.]+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return sanitized || 'file';
}

export function createSignalAssetId(file: File, contentHash: string): string {
  const hashPart = contentHash.replace(/^sha256:/, '').slice(0, 12) || 'unhashed';
  return `signal:${sanitizeIdPart(file.name)}:${hashPart}`;
}

export function createSignalArtifactId(assetId: string, role: string): string {
  return `${assetId}:artifact:${role}`;
}

export function cloneArrayBuffer(buffer: ArrayBuffer): ArrayBuffer {
  return buffer.slice(0);
}

export function uint8ArrayToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export async function readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  const blobWithArrayBuffer = blob as Blob & { arrayBuffer?: () => Promise<ArrayBuffer> };
  if (typeof blobWithArrayBuffer.arrayBuffer === 'function') {
    return blobWithArrayBuffer.arrayBuffer();
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read blob bytes'));
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(reader.result);
        } else {
          reject(new Error('Blob reader returned non-binary data'));
        }
      };
      reader.readAsArrayBuffer(blob);
    });
  }

  return new Response(blob).arrayBuffer();
}

export function readFileRangeAsArrayBuffer(file: File, start: number, end: number): Promise<ArrayBuffer> {
  return readBlobAsArrayBuffer(file.slice(start, end));
}
