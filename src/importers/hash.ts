import { uint8ArrayToArrayBuffer } from './fileIdentity';

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256ArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
  return `sha256:${bytesToHex(new Uint8Array(digest))}`;
}

export async function sha256Utf8(value: string): Promise<string> {
  return sha256ArrayBuffer(uint8ArrayToArrayBuffer(new TextEncoder().encode(value)));
}
