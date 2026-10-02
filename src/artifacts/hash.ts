import { StreamHash } from '../services/project/repository/segments/streamHash';
import { ARTIFACT_HASH_ALGORITHM, type ArtifactInput } from './types';

type Sha256Input = ArrayBuffer | ArrayBufferView;
type CryptoDigestBytes = Uint8Array<ArrayBuffer>;

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function copyCryptoDigestBytes(source: Uint8Array): CryptoDigestBytes {
  const copy = new Uint8Array(source.byteLength);
  copy.set(source);
  return copy;
}

function toCryptoDigestBytes(input: Sha256Input): CryptoDigestBytes {
  const source = ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);

  return copyCryptoDigestBytes(source);
}

export async function artifactInputToBlob(
  input: ArtifactInput,
  mimeType = 'application/octet-stream',
): Promise<Blob> {
  if (input instanceof Blob) {
    return input;
  }

  return new Blob([input as BlobPart], { type: mimeType });
}

export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if ('arrayBuffer' in blob && typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }

      reject(new Error('Blob reader did not return an ArrayBuffer'));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

export async function sha256ArrayBuffer(buffer: Sha256Input): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is not available in this runtime');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', toCryptoDigestBytes(buffer));
  return toHex(digest);
}

export async function sha256ArtifactInput(input: ArtifactInput): Promise<string> {
  const blob = await artifactInputToBlob(input);
  return sha256Blob(blob);
}

export function getArtifactHashAlgorithm(): typeof ARTIFACT_HASH_ALGORITHM {
  return ARTIFACT_HASH_ALGORITHM;
}

/** Full SHA-256 over bounded slices; never materializes the whole original. */
export async function sha256Blob(blob: Blob, signal?: AbortSignal): Promise<string> {
  const hash = new StreamHash();
  for (let offset = 0; offset < blob.size; offset += 256 * 1024) {
    signal?.throwIfAborted();
    hash.update(new Uint8Array(await blobToArrayBuffer(blob.slice(offset, offset + 256 * 1024))));
  }
  signal?.throwIfAborted();
  return hash.digest().slice(7);
}
