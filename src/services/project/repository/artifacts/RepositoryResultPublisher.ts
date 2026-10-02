import type { ArtifactInput, ArtifactManifest, PutArtifactOptions } from '../../../../artifacts/types';
import { ArtifactStore } from '../../../../artifacts/ArtifactStore';
import { RepositoryError } from '../contracts';
import { frozenJson } from '../segments/canonical';
export interface ResultBinding {
  repositoryId: string; sessionEpoch: string; sourceVersion: string; targetEntity: string; targetBindingVersion: string;
}
export interface ResultPublicationHost {
  /** Journal append is epoch-bound to the originating repository, even after UI switches. */
  appendJournal(id: string, event: { type: 'result-completed'; binding: ResultBinding; artifactId: string; applied: boolean }): Promise<void>;
  /** Local recovery store for a result finishing after its repository owner was released. */
  retainUnbound?(binding: ResultBinding, input: ArtifactInput, options: PutArtifactOptions, resultId: string): Promise<ArtifactManifest>;
  matches(binding: ResultBinding): boolean;
  /** Must synchronously recheck ownership and apply within an explicit project transaction. */
  apply(binding: ResultBinding, manifest: ArtifactManifest): boolean;
}
/** Finished bytes survive late callbacks; binding mismatch never edits a new session. */
export class RepositoryResultPublisher {
  private readonly artifacts: ArtifactStore;
  private readonly host: ResultPublicationHost;
  constructor(artifacts: ArtifactStore, host: ResultPublicationHost) {
    this.artifacts = artifacts; this.host = host;}
  async publish(binding: ResultBinding, input: ArtifactInput, options: PutArtifactOptions = {}, resultId = crypto.randomUUID()): Promise<{ manifest: ArtifactManifest; applied: boolean }> {
    const pinned = frozenJson(binding);
    const artifactOptions: PutArtifactOptions = { ...options, retention: options.retention ?? 'required', sourceRefs: [...new Set([...(options.sourceRefs ?? []), pinned.sourceVersion])] };
    let manifest: ArtifactManifest;
    try { manifest = (await this.artifacts.putArtifact(input, artifactOptions)).manifest; }
    catch (error) {
      if (!(error instanceof RepositoryError) || error.code !== 'ownership' || !this.host.retainUnbound) throw error;
      manifest = await this.host.retainUnbound(pinned, input, artifactOptions, resultId);
    }
    // There is no await between the final identity check and transactional attachment.
    const applied = this.host.matches(pinned) && this.host.apply(pinned, manifest);
    await this.host.appendJournal(resultId, { type: 'result-completed', binding: pinned, artifactId: manifest.artifactId, applied });
    return { manifest, applied };
  }
}
