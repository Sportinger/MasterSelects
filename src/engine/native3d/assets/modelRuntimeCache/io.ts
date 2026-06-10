import { NativeHelperClient } from '../../../../services/nativeHelper/NativeHelperClient';

type NativeFileReferenceClient = {
  parseFileReferenceUrl?: (url: string | undefined) => string | null;
  getDownloadedFile?: (path: string) => Promise<ArrayBuffer | null>;
};

function parseNativeFileReferenceUrl(url: string): string | null {
  const client = NativeHelperClient as NativeFileReferenceClient;
  return typeof client.parseFileReferenceUrl === 'function'
    ? client.parseFileReferenceUrl(url)
    : null;
}

async function getNativeFileBytes(path: string): Promise<ArrayBuffer | null> {
  const client = NativeHelperClient as NativeFileReferenceClient;
  return typeof client.getDownloadedFile === 'function'
    ? client.getDownloadedFile(path)
    : null;
}

export async function fetchModelBytes(url: string): Promise<{ bytes: ArrayBuffer; contentType?: string } | null> {
  const nativePath = parseNativeFileReferenceUrl(url);
  if (nativePath) {
    const bytes = await getNativeFileBytes(nativePath);
    return bytes ? { bytes } : null;
  }

  const response = await fetch(url);
  if (!response.ok) {
    return null;
  }

  return {
    bytes: await response.arrayBuffer(),
    contentType: response.headers?.get('content-type') ?? undefined,
  };
}

export async function fetchModelText(url: string): Promise<string | null> {
  const nativePath = parseNativeFileReferenceUrl(url);
  if (nativePath) {
    const bytes = await getNativeFileBytes(nativePath);
    return bytes ? new TextDecoder().decode(bytes) : null;
  }

  const response = await fetch(url);
  return response.ok ? response.text() : null;
}

export function decodeText(buffer: ArrayBuffer): string {
  return new TextDecoder().decode(buffer);
}

export function decodeDataUri(uri: string): ArrayBuffer | null {
  const match = uri.match(/^data:.*?(;base64)?,(.*)$/i);
  if (!match) {
    return null;
  }
  const isBase64 = !!match[1];
  const payload = match[2] ?? '';

  if (isBase64) {
    if (typeof atob === 'function') {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    }
    if (typeof Buffer !== 'undefined') {
      const bytes = Buffer.from(payload, 'base64');
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
    return null;
  }

  const text = decodeURIComponent(payload);
  return new TextEncoder().encode(text).buffer;
}

export function sliceBuffer(buffer: ArrayBuffer, byteOffset: number, byteLength: number): ArrayBuffer {
  return buffer.slice(byteOffset, byteOffset + byteLength);
}
