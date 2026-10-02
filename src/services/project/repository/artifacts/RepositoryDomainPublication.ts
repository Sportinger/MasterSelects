import type { ArtifactStore } from '../../../../artifacts/ArtifactStore';
import type { ArtifactManifest } from '../../../../artifacts/types';
import type { JsonValue } from '../contracts';
import type { ProjectFolderKey } from '../../core/constants';
/** Captured hosts stay bound to their original location after editor activation changes. */
export interface RepositoryDomainPublication {
  readonly repositoryId: string;
  readonly sessionEpoch: string;
  readonly artifacts: ArtifactStore;
  readFile(folder: ProjectFolderKey, name: string): Promise<File | null>;
  writeFile(folder: ProjectFolderKey, name: string, input: string | Blob | ArrayBuffer): Promise<boolean>;
  deleteFile(folder: ProjectFolderKey, name: string): Promise<boolean>;
  /** Allocates through the same session coordinator, never a second sequence. */
  appendJournal(id: string, value: JsonValue): Promise<void>;
  readJournal(id: string): Promise<JsonValue | null>;
  /** Must journal original-session evidence and synchronously guard source + entity binding. */
  publishResult(domain: string, target: string, sourceVersion: string, manifest: ArtifactManifest): Promise<void>;
}
let publication: RepositoryDomainPublication | null = import.meta.hot?.data?.repositoryDomainPublication ?? null;
if (import.meta.hot) import.meta.hot.dispose(data => { data.repositoryDomainPublication = publication; });
export function setRepositoryDomainPublication(next: RepositoryDomainPublication | null): void { publication = next; }
export function captureRepositoryDomainPublication(): RepositoryDomainPublication | null { return publication; }
