import type { ArtifactStore } from '../../../artifacts';
import { projectFileService } from '../../project/ProjectFileService';
import { artifactService } from '../../project/domains/ArtifactService';
import type {
  AgentTimelineManifestPointer,
  AgentTimelineManifestPointerStore,
} from '../../../types/agentTimeline/storage';
import { AgentTimelineArtifactStorage } from './AgentTimelineArtifactStorage';
import type { AgentTimelineArtifactStore } from './artifactStoreBoundary';

const POINTER_FILE_PREFIX = 'agent-timeline-pointer-v1-';
const MAX_POINTER_BYTES = 64 * 1024;

function artifactStoreAdapter(store: ArtifactStore): AgentTimelineArtifactStore {
  return {
    async putArtifact(input, options) {
      const result = await store.putArtifact(input, {
        mimeType: options.mimeType,
        encoding: options.encoding,
        sourceRefs: [...options.sourceRefs],
      });
      return {
        manifest: {
          artifactId: result.manifest.artifactId,
          hash: result.manifest.hash,
          size: result.manifest.size,
          sourceRefs: [...result.manifest.sourceRefs],
        },
      };
    },
    async getArtifact(ref) {
      const stored = await store.getArtifact(ref);
      if (!stored) return null;
      return {
        manifest: {
          artifactId: stored.manifest.artifactId,
          hash: stored.manifest.hash,
          size: stored.manifest.size,
          sourceRefs: [...stored.manifest.sourceRefs],
        },
        blob: stored.blob,
      };
    },
  };
}

/**
 * Resolves the same project-scoped artifact backend used by Agent Timeline
 * manifests. Runtime readers use this boundary only after storage has already
 * validated a manifest/index pair.
 */
export function createProjectAgentTimelineArtifactStore(): AgentTimelineArtifactStore {
  const projectHandle = projectFileService.getProjectHandle();
  return artifactStoreAdapter(projectHandle
    ? artifactService.createStore(projectHandle)
    : artifactService.createIndexedDBStore());
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export class ProjectFileManifestPointerStore implements AgentTimelineManifestPointerStore {
  private async fileName(pointerKey: string): Promise<string> {
    return `${POINTER_FILE_PREFIX}${await sha256Hex(pointerKey)}.json`;
  }

  async get(pointerKey: string): Promise<AgentTimelineManifestPointer | null> {
    const file = await projectFileService.readFile('ANALYSIS', await this.fileName(pointerKey));
    if (!file) return null;
    if (file.size > MAX_POINTER_BYTES) {
      throw new Error('Agent Timeline manifest pointer exceeds its bounded size.');
    }
    return JSON.parse(await file.text()) as AgentTimelineManifestPointer;
  }

  async set(pointerKey: string, pointer: AgentTimelineManifestPointer): Promise<void> {
    const json = JSON.stringify(pointer);
    if (new TextEncoder().encode(json).byteLength > MAX_POINTER_BYTES) {
      throw new Error('Agent Timeline manifest pointer exceeds its bounded size.');
    }
    const written = await projectFileService.writeFile(
      'ANALYSIS',
      await this.fileName(pointerKey),
      json,
    );
    if (!written) throw new Error('Could not publish the Agent Timeline manifest pointer.');
  }
}

export class BrowserManifestPointerStore implements AgentTimelineManifestPointerStore {
  private readonly storage: Storage;
  private readonly namespace: string;

  constructor(
    storage: Storage,
    namespace: string,
  ) {
    this.storage = storage;
    this.namespace = namespace;
  }

  private key(pointerKey: string): string {
    return `masterselects:agent-timeline:${encodeURIComponent(this.namespace)}:${pointerKey}`;
  }

  async get(pointerKey: string): Promise<AgentTimelineManifestPointer | null> {
    const value = this.storage.getItem(this.key(pointerKey));
    if (value === null) return null;
    if (new TextEncoder().encode(value).byteLength > MAX_POINTER_BYTES) {
      throw new Error('Agent Timeline manifest pointer exceeds its bounded size.');
    }
    return JSON.parse(value) as AgentTimelineManifestPointer;
  }

  async set(pointerKey: string, pointer: AgentTimelineManifestPointer): Promise<void> {
    const json = JSON.stringify(pointer);
    if (new TextEncoder().encode(json).byteLength > MAX_POINTER_BYTES) {
      throw new Error('Agent Timeline manifest pointer exceeds its bounded size.');
    }
    this.storage.setItem(this.key(pointerKey), json);
  }
}

/**
 * Uses portable project artifacts + project pointer files for FSA projects.
 * Native/unattached sessions use the existing IndexedDB artifact adapter and
 * a project-namespaced browser pointer because native artifact-file support is
 * not exposed by ArtifactService.
 */
export function createProjectAgentTimelineStorage(): AgentTimelineArtifactStorage {
  const projectHandle = projectFileService.getProjectHandle();
  const project = projectFileService.getProjectData();
  const projectNamespace = project
    ? `${project.createdAt}:${project.name}`
    : projectFileService.getProjectPath() ?? 'unattached';
  const artifacts = createProjectAgentTimelineArtifactStore();
  const pointers = projectHandle
    ? new ProjectFileManifestPointerStore()
    : new BrowserManifestPointerStore(globalThis.localStorage, projectNamespace);
  return new AgentTimelineArtifactStorage({ artifacts, pointers });
}
