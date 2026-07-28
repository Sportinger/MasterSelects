import { describe, expect, it } from 'vitest';
import {
  BrowserManifestPointerStore,
} from '../../src/services/agentTimeline/storage/projectAgentTimelineStorage';
import type { AgentTimelineManifestPointer } from '../../src/types/agentTimeline/storage';

const pointer: AgentTimelineManifestPointer = {
  type: 'agent-timeline-manifest-pointer',
  schemaVersion: 'agent-timeline-manifest-pointer/v1',
  mediaFileId: 'media-a',
  sourceIdentityHash: 'a'.repeat(64),
  manifestRef: 'sha256:manifest',
  shardIndexRef: 'sha256:index',
  publishedAt: '2026-07-27T00:00:00.000Z',
};

describe('project Agent Timeline pointer adapters', () => {
  it('isolates IndexedDB artifact pointers by project namespace', async () => {
    const storage = new Map<string, string>();
    const adapter: Storage = {
      get length() { return storage.size; },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => [...storage.keys()][index] ?? null,
      removeItem: (key) => { storage.delete(key); },
      setItem: (key, value) => { storage.set(key, value); },
    };
    const projectA = new BrowserManifestPointerStore(adapter, 'project-a');
    const projectB = new BrowserManifestPointerStore(adapter, 'project-b');

    await projectA.set('agent-timeline/manifest/media-a', pointer);

    await expect(projectA.get('agent-timeline/manifest/media-a')).resolves.toEqual(pointer);
    await expect(projectB.get('agent-timeline/manifest/media-a')).resolves.toBeNull();
  });

  it('surfaces malformed pointer JSON instead of treating it as a cache miss', async () => {
    const key = 'masterselects:agent-timeline:project-a:pointer';
    const adapter = {
      getItem: () => '{invalid',
      setItem: () => undefined,
    } as unknown as Storage;
    const store = new BrowserManifestPointerStore(adapter, 'project-a');

    await expect(store.get(key)).rejects.toThrow();
  });
});

