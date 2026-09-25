import { webcrypto } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ProjectDocument } from '../../src/types/documents';

const storage = vi.hoisted(() => new Map<string, Blob | string>());
vi.mock('../../src/services/projectFileService', () => ({
  projectFileService: {
    writeFile: vi.fn(async (_folder: string, fileName: string, value: Blob | string) => {
      storage.set(fileName, value);
      return true;
    }),
    readFile: vi.fn(async (_folder: string, fileName: string) => {
      const value = storage.get(fileName);
      return value === undefined ? null : {
        text: async () => typeof value === 'string' ? value : value.text(),
        arrayBuffer: async () => {
          if (typeof value === 'string') return new TextEncoder().encode(value).buffer;
          return new Promise<ArrayBuffer>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(value);
          });
        },
      };
    }),
  },
}));

import { projectFileService } from '../../src/services/projectFileService';
import { readDocumentsManifest, writeDocumentsManifest } from '../../src/services/documents/documentArtifacts';

const makeDocument = (text: string): ProjectDocument => ({
  id: 'doc-1', title: 'Notes', kind: 'general', schemaVersion: 1,
  revision: 1, createdAt: 1, updatedAt: 1,
  blocks: [{ id: 'block-1', kind: 'paragraph', text }], links: [], comments: [],
});

beforeAll(() => vi.stubGlobal('crypto', webcrypto));
afterAll(() => vi.unstubAllGlobals());

describe('document artifacts', () => {
  it('reuses unchanged content but writes new content even with the same ID and revision', async () => {
    storage.clear();
    vi.mocked(projectFileService.writeFile).mockClear();
    const first = await writeDocumentsManifest({ schemaVersion: 1, documents: [makeDocument('old')] }, undefined);
    const same = await writeDocumentsManifest({ schemaVersion: 1, documents: [makeDocument('old')] }, first);
    const changed = await writeDocumentsManifest({ schemaVersion: 1, documents: [makeDocument('new')] }, same);

    expect(same.artifacts[0].fileName).toBe(first.artifacts[0].fileName);
    expect(changed.artifacts[0].fileName).not.toBe(first.artifacts[0].fileName);
    expect(projectFileService.writeFile).toHaveBeenCalledTimes(2);
    expect((await readDocumentsManifest(first))?.documents[0].blocks[0].text).toBe('old');
    expect((await readDocumentsManifest(changed))?.documents[0].blocks[0].text).toBe('new');
  });

  it('stores a PDF original once across edited document revisions and restores its bytes', async () => {
    storage.clear();
    vi.mocked(projectFileService.writeFile).mockClear();
    const original = btoa('%PDF-1.7\nproject original');
    const document: ProjectDocument = { ...makeDocument('first'),
      source: { fileName: 'script.pdf', mimeType: 'application/pdf', format: 'pdf',
        importedAt: 1, byteLength: 25, fidelity: 'source', originalData: original } };
    const first = await writeDocumentsManifest({ schemaVersion: 1, documents: [document] }, undefined);
    const second = await writeDocumentsManifest({ schemaVersion: 1, documents: [
      { ...document, revision: 2, blocks: [{ ...document.blocks[0], text: 'edited' }] },
    ] }, first);

    expect(first.schemaVersion).toBe(3);
    expect(second.artifacts[0].original).toEqual(first.artifacts[0].original);
    expect(second.artifacts[0].fileName).not.toBe(first.artifacts[0].fileName);
    expect(projectFileService.writeFile).toHaveBeenCalledTimes(3);
    expect((await readDocumentsManifest(second))?.documents[0].source?.originalData).toBe(original);
    expect((storage.get(second.artifacts[0].fileName) as string)).not.toContain(original);
  });
});
