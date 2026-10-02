import { RepositoryError, type JsonValue, type RecordReference } from '../contracts';
import type { DraftPublication } from '../storageWorkerProtocol';
import type { PublicationBatch } from './publication';

function resolveValue(value: JsonValue, resolve: (id: string) => RecordReference): JsonValue {
  if (Array.isArray(value)) return value.map(item => resolveValue(item, resolve));
  if (value && typeof value === 'object') {
    if (Object.keys(value).length === 1 && typeof value.$record === 'string') return resolve(value.$record) as unknown as JsonValue;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveValue(item, resolve)]));
  }
  return value;
}
export function draftPublication(batch: DraftPublication): PublicationBatch {
  if (batch.records.length > 65536) throw new RepositoryError('budget', 'Publication record count exceeds safety budget');
  return { ...batch, records: batch.records.map(record => ({ id: record.id, build: resolve => ({
    kind: record.kind, schemaVersion: record.schemaVersion, payload: resolveValue(record.payload, resolve),
    references: record.references.map(reference => typeof reference === 'string' ? resolve(reference) : reference), blobs: record.blobs,
  }) })) };
}
