import { REPOSITORY_LIMITS, RepositoryError, type RecordReference, type RepositoryBackend, type RepositoryRecord, type SegmentDescriptor } from '../contracts';
import { canonicalBytes, hashBytes, hashRecord, parseJson } from './canonical';

export const SEGMENT_HEADER = new TextEncoder().encode('MSRECORD1\n');
export function segmentPath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new RepositoryError('corrupt', 'Invalid segment ID');
  return `.masterselects/segments/${id}.msseg`;
}
export interface PreparedSegment { descriptor: SegmentDescriptor; bytes: Uint8Array; }
export class SegmentBuilder {
  private segmentId = crypto.randomUUID();
  private parts: Uint8Array[] = [SEGMENT_HEADER];
  private size = SEGMENT_HEADER.length;
  readonly segments: PreparedSegment[] = [];
  async add(record: RepositoryRecord): Promise<RecordReference> {
    const bytes = canonicalBytes(record);
    if (bytes.length > REPOSITORY_LIMITS.recordBytes) throw new RepositoryError('budget', 'Record exceeds bounded aggregate limit');
    if (this.size + bytes.length + 4 > REPOSITORY_LIMITS.segmentBytes) await this.seal();
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, bytes.length);
    const ref = { hash: await hashRecord(record), segmentId: this.segmentId, offset: this.size + 4, length: bytes.length };
    this.parts.push(length, bytes); this.size += bytes.length + 4;
    return ref;
  }
  async seal(): Promise<void> {
    if (this.parts.length === 1) return;
    const bytes = new Uint8Array(this.size);
    let position = 0;
    for (const part of this.parts) { bytes.set(part, position); position += part.length; }
    this.segments.push({ descriptor: { segmentId: this.segmentId, hash: await hashBytes(bytes), length: bytes.length }, bytes });
    this.segmentId = crypto.randomUUID(); this.parts = [SEGMENT_HEADER]; this.size = SEGMENT_HEADER.length;
  }
}

export function validateReference(ref: RecordReference): void {
  segmentPath(ref.segmentId);
  if (!/^sha256:[a-f0-9]{64}$/.test(ref.hash) || !Number.isSafeInteger(ref.offset) || ref.offset < SEGMENT_HEADER.length + 4 || !Number.isSafeInteger(ref.length) || ref.length < 1 || ref.length > REPOSITORY_LIMITS.recordBytes) throw new RepositoryError('corrupt', 'Invalid direct record reference');
}
export function validateRecord(record: RepositoryRecord): void {
  if (!record || record.schemaVersion !== 1 || !['object', 'revision', 'checkpoint', 'metadata', 'navigation', 'journal'].includes(record.kind) || !Array.isArray(record.references) || !Array.isArray(record.blobs)) throw new RepositoryError('corrupt', 'Invalid repository record envelope');
  record.references.forEach(validateReference);
  for (const blob of record.blobs) if (!/^sha256:[a-f0-9]{64}$/.test(blob.hash) || !Number.isSafeInteger(blob.length) || blob.length < 0) throw new RepositoryError('corrupt', 'Invalid blob reference');
  canonicalBytes(record);
  const declared = new Set(record.references.map(ref => `${ref.hash}:${ref.segmentId}:${ref.offset}:${ref.length}`));
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== 'object') return;
    const item = value as Record<string, unknown>;
    if (Object.keys(item).length === 4 && typeof item.hash === 'string' && typeof item.segmentId === 'string' && typeof item.offset === 'number' && typeof item.length === 'number') {
      if (!declared.has(`${item.hash}:${item.segmentId}:${item.offset}:${item.length}`)) throw new RepositoryError('corrupt', 'Undeclared transitive record reference');
      return;
    }
    Object.values(item).forEach(visit);
  };
  visit(record.payload);
}
export async function readRecord(backend: RepositoryBackend, ref: RecordReference, signal?: AbortSignal): Promise<RepositoryRecord> {
  validateReference(ref);
  const path = segmentPath(ref.segmentId);
  const prefix = await backend.read(path, 0, SEGMENT_HEADER.length, signal);
  if (!prefix.every((byte, i) => byte === SEGMENT_HEADER[i]) || prefix.length !== SEGMENT_HEADER.length) throw new RepositoryError('corrupt', 'Unknown segment framing');
  const frame = await backend.read(path, ref.offset - 4, ref.length + 4, signal);
  if (frame.length !== ref.length + 4 || new DataView(frame.buffer, frame.byteOffset, 4).getUint32(0) !== ref.length) throw new RepositoryError('corrupt', 'Truncated segment frame');
  const record = parseJson<RepositoryRecord>(frame.subarray(4)); validateRecord(record);
  if (await hashRecord(record) !== ref.hash) throw new RepositoryError('corrupt', 'Record hash mismatch');
  return record;
}
export async function* segmentRecords(backend: RepositoryBackend, descriptor: SegmentDescriptor, signal?: AbortSignal): AsyncGenerator<{ reference: RecordReference; record: RepositoryRecord }> {
  if (descriptor.length > REPOSITORY_LIMITS.segmentBytes || descriptor.length < SEGMENT_HEADER.length) throw new RepositoryError('corrupt', 'Segment size outside format bounds');
  const bytes = await backend.read(segmentPath(descriptor.segmentId), 0, descriptor.length, signal);
  if (bytes.length !== descriptor.length || await hashBytes(bytes) !== descriptor.hash || !SEGMENT_HEADER.every((byte, i) => bytes[i] === byte)) throw new RepositoryError('corrupt', 'Segment integrity failure');
  let offset = SEGMENT_HEADER.length;
  while (offset < bytes.length) {
    if (offset + 4 > bytes.length) throw new RepositoryError('corrupt', 'Truncated record header');
    const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0); offset += 4;
    if (length < 1 || length > REPOSITORY_LIMITS.recordBytes || offset + length > bytes.length) throw new RepositoryError('corrupt', 'Truncated record body');
    const record = parseJson<RepositoryRecord>(bytes.subarray(offset, offset + length)); validateRecord(record);
    yield { reference: { hash: await hashRecord(record), segmentId: descriptor.segmentId, offset, length }, record };
    offset += length;
  }
}
