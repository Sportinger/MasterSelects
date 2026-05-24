import { ARTIFACT_HASH_ALGORITHM, type ArtifactInput } from './types';

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
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

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Web Crypto SHA-256 is not available in this runtime');
  }

  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return toHex(digest);
}

export async function sha256ArtifactInput(input: ArtifactInput): Promise<string> {
  const blob = await artifactInputToBlob(input);
  return sha256ArrayBuffer(await blobToArrayBuffer(blob));
}

export function getArtifactHashAlgorithm(): typeof ARTIFACT_HASH_ALGORITHM {
  return ARTIFACT_HASH_ALGORITHM;
}
