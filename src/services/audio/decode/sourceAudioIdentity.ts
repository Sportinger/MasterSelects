// Content identity of a source file for sharing whole-source audio decodes.
//
// Name, size and modification time alone can collide for a replaced file: a copy
// that preserves mtime (cp -p, unzip, sync tools) with the same byte length would
// otherwise be served the decode result, or the remembered failure, of the old
// bytes. The identity therefore also hashes the first and last 64 KiB, which
// covers the container header and the trailing index of every common audio
// format. One identity is computed per File object: a File is a snapshot, and a
// browser refuses to read it once the file on disk changed.

import { sha256ArrayBuffer } from '../../../artifacts';
import { readFileRangeAsArrayBuffer } from '../../../importers/fileIdentity';
import { Logger } from '../../logger';

const log = Logger.create('SourceAudioIdentity');

export const SOURCE_AUDIO_IDENTITY_SAMPLE_BYTES = 64 * 1024;

const identities = new WeakMap<File, Promise<string | null>>();

async function computeIdentity(file: File): Promise<string | null> {
  const metadata = `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
  try {
    const headEnd = Math.min(file.size, SOURCE_AUDIO_IDENTITY_SAMPLE_BYTES);
    const tailStart = Math.max(headEnd, file.size - SOURCE_AUDIO_IDENTITY_SAMPLE_BYTES);
    const [head, tail] = await Promise.all([
      readFileRangeAsArrayBuffer(file, 0, headEnd),
      readFileRangeAsArrayBuffer(file, tailStart, file.size),
    ]);
    const sample = new Uint8Array(head.byteLength + tail.byteLength);
    sample.set(new Uint8Array(head), 0);
    sample.set(new Uint8Array(tail), head.byteLength);
    return `${metadata}\u0000${await sha256ArrayBuffer(sample)}`;
  } catch (error) {
    // Without a content sample the source is decoded on its own, never shared or remembered.
    log.debug('Source audio identity unavailable; decoding without sharing', { file: file.name, error });
    return null;
  }
}

/** Metadata plus a head/tail content hash, or null when the bytes cannot be sampled. */
export function sourceAudioDecodeIdentity(file: File): Promise<string | null> {
  let identity = identities.get(file);
  if (!identity) {
    const computed = computeIdentity(file);
    identities.set(file, computed);
    // A failed sample read may be transient; the next caller tries again.
    void computed.then(value => { if (value === null && identities.get(file) === computed) identities.delete(file); });
    identity = computed;
  }
  return identity;
}
