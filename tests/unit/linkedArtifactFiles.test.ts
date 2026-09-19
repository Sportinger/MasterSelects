import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync, zipSync, strToU8 } from 'fflate';
import type { ProjectFile } from '../../src/services/project/types';
import { decodeProjectPackage, ProjectPackageSession } from '../../src/services/project/core/projectPackage';
import { writeFsaProjectPackage } from '../../src/services/project/core/projectCorePersistence';
import { isLinkedArtifactEntry, linkedArtifactPath, readLinkedArtifact } from '../../src/services/project/core/linkedArtifactFiles';

const artifact = `Cache/artifacts/sha256/aa/${'a'.repeat(64)}/artifact.bin`;
const project = { version: 1, name: 'Test', createdAt: '2026-01-01', updatedAt: '2026-01-01',
  compositions: [], media: [], folders: [], settings: {}, openCompositionIds: [], expandedFolderIds: [],
  activeCompositionId: null } as unknown as ProjectFile;

function disk() {
  const files = new Map<string, Uint8Array>();
  const writes: string[] = [];
  let failBinary = false;
  function directory(prefix = ''): FileSystemDirectoryHandle {
    return {
      getDirectoryHandle: async (name: string) => directory(`${prefix}${name}/`),
      getFileHandle: async (name: string) => ({
        getFile: async () => ({ arrayBuffer: async () => {
          const bytes = files.get(prefix + name);
          if (!bytes) throw new Error('Missing file');
          return bytes.slice().buffer;
        } }),
        createWritable: async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: async (bytes: ArrayBuffer) => { chunks.push(new Uint8Array(bytes).slice()); },
            close: async () => {
              if (failBinary && name === 'artifact.bin') throw new Error('Disk full');
              const bytes = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
              let offset = 0;
              for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              files.set(prefix + name, bytes); writes.push(prefix + name);
            },
            abort: async () => undefined,
          };
        },
      }),
    } as unknown as FileSystemDirectoryHandle;
  }
  return { root: directory(), files, writes, fail: (value: boolean) => { failBinary = value; } };
}

describe('linked artifact persistence', () => {
  it('migrates embedded binaries, writes only metadata on edits, reloads, and can embed for transport', async () => {
    const fs = disk();
    const initial = ProjectPackageSession.create(project);
    const bytes = new Uint8Array(256 * 1024).fill(37);
    initial.addMigratedEntry(artifact, bytes);
    initial.addMigratedEntry('Analysis/audio.json', strToU8('{"ready":true}'));
    const legacy = await decodeProjectPackage(await initial.encode(project));
    const session = ProjectPackageSession.fromArchive(legacy, 'Test.msproj');
    await writeFsaProjectPackage(fs.root, session, project);
    const raw = unzipSync(fs.files.get('Test.msproj')!);
    expect(raw[artifact]).toBeUndefined();
    expect(raw['Analysis/audio.json']).toBeDefined();
    expect(JSON.parse(strFromU8(raw['manifest.json'])).linkedArtifactEntries).toEqual([artifact]);
    expect(fs.writes.at(-1)).toBe('Test.msproj');
    expect(fs.files.get(`Test Media/${linkedArtifactPath(artifact)}`)).toEqual(bytes);
    fs.writes.length = 0;
    await writeFsaProjectPackage(fs.root, session, { ...project, updatedAt: '2026-01-02' });
    expect(fs.writes).toEqual(['Test.msproj']);
    const restored = await decodeProjectPackage(fs.files.get('Test.msproj')!, (folder, path) => readLinkedArtifact(fs.root, folder, path));
    expect(restored.entries.get(artifact)).toEqual(bytes);
    const reopened = ProjectPackageSession.fromArchive(restored, 'Test.msproj');
    const portable = await decodeProjectPackage(await reopened.encode(project));
    expect(portable.manifest.linkedArtifactEntries).toBeUndefined();
    expect(portable.entries.get(artifact)).toEqual(bytes);
    fs.writes.length = 0;
    await writeFsaProjectPackage(fs.root, reopened, project);
    expect(fs.writes).toEqual(['Test.msproj']);
  });

  it('keeps the old project intact if a binary fails and retries before publishing', async () => {
    const fs = disk();
    const session = ProjectPackageSession.create(project);
    await writeFsaProjectPackage(fs.root, session, project);
    const previous = fs.files.get('Test.msproj');
    session.addMigratedEntry(artifact, new Uint8Array([1, 2, 3]));
    fs.fail(true);
    await expect(writeFsaProjectPackage(fs.root, session, project)).rejects.toThrow('Disk full');
    expect(fs.files.get('Test.msproj')).toBe(previous);
    fs.fail(false);
    await writeFsaProjectPackage(fs.root, session, project);
    expect(fs.files.get('Test.msproj')).not.toBe(previous);
  });

  it('requires the companion folder and rejects traversal paths before reading', async () => {
    const fs = disk();
    const session = ProjectPackageSession.create(project);
    session.addMigratedEntry(artifact, new Uint8Array([1]));
    await writeFsaProjectPackage(fs.root, session, project);
    await expect(decodeProjectPackage(fs.files.get('Test.msproj')!)).rejects.toThrow('linked media folder');
    const entries = unzipSync(fs.files.get('Test.msproj')!);
    const manifest = JSON.parse(strFromU8(entries['manifest.json']));
    manifest.linkedArtifactEntries = ['../../outside'];
    entries['manifest.json'] = new Uint8Array(strToU8(JSON.stringify(manifest)));
    await expect(decodeProjectPackage(zipSync(entries))).rejects.toThrow('Invalid linked artifact');
    expect(isLinkedArtifactEntry(artifact.replace('/aa/', '/bb/'))).toBe(false);
  });
});
