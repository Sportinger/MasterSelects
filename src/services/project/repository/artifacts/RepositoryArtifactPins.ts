import { RepositoryError, type BlobReference, type RecordReference } from '../contracts';
export interface ArtifactPin { purpose: 'reader' | 'export' | 'backup' | 'transaction' | 'recovery' | 'import' | 'job'; blobs: readonly BlobReference[]; manifests: readonly string[]; records: readonly RecordReference[]; }
/** Session-local pins complement permanent commit/journal/view roots. */
export class RepositoryArtifactPins {
  private readonly entries = new Map<symbol, ArtifactPin>();
  private version = 0;
  pin(pin: ArtifactPin): () => void {
    if (this.entries.size >= 512 || [...this.entries.values()].reduce((total, entry) => total + entry.blobs.length + entry.manifests.length + entry.records.length, pin.blobs.length + pin.manifests.length + pin.records.length) > 4096) throw new RepositoryError('budget', 'Artifact pin budget exceeded');
    const token = Symbol(pin.purpose); this.entries.set(token, structuredClone(pin)); this.version++;
    return () => { if (this.entries.delete(token)) this.version++; };
  }
  snapshot(): { generation: number; pins: readonly ArtifactPin[] } { return { generation: this.version, pins: [...this.entries.values()] }; }
  assertGeneration(generation: number): void { if (generation !== this.version) throw new RepositoryError('ownership', 'Artifact roots changed during retention'); }
}
