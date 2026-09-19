import { describe, expect, it } from 'vitest';
import { ProjectPackageSession, decodeProjectPackage } from '../../src/services/project/core/projectPackage';
import { writeFsaProjectPackage } from '../../src/services/project/core/projectCorePersistence';
import type { ProjectFile } from '../../src/services/project/types';

function project(): ProjectFile {
  const mesh = { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2], origin: [0, 0, 0],
    axisX: [1, 0, 0], axisY: [0, 1, 0], normal: [0, 0, 1], size: [1, 1] };
  return { version: 1, name: 'Terrain', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    compositions: [{ clips: [{ planarTracks: [{ terrain: { denseMesh: mesh } }] }] }],
  } as unknown as ProjectFile;
}
function filesystem(failGeometry = false) {
  const files = new Map<string, Uint8Array>(); const writes: string[] = [];
  function directory(prefix = ''): FileSystemDirectoryHandle {
    return {
      getDirectoryHandle: async (name: string) => directory(prefix + name + '/'),
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          const chunks: Uint8Array[] = [];
          return {
            write: async (value: ArrayBuffer) => {
              if (failGeometry && prefix.includes('Geometry/')) throw new Error('disk full');
              chunks.push(new Uint8Array(value).slice());
            },
            close: async () => {
              const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
              let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
              files.set(prefix + name, bytes); writes.push(prefix + name);
            }, abort: async () => undefined,
          };
        },
      }),
    } as unknown as FileSystemDirectoryHandle;
  }
  return { root: directory(), files, writes };
}
describe('linked immutable terrain persistence', () => {
  it('writes geometry before the project, then saves only the small package on edits', async () => {
    const data = project(); const session = ProjectPackageSession.create(data); const fs = filesystem();
    await writeFsaProjectPackage(fs.root, session, data);
    expect(fs.writes[0]).toContain('Geometry/terrain/');
    expect(fs.writes.at(-1)).toBe('Terrain.msproj');
    const archive = await decodeProjectPackage(fs.files.get('Terrain.msproj')!, async (folder, path) => fs.files.get(`${folder}/${path}`)!);
    expect(archive.projectData).toEqual(data);
    const before = fs.writes.length; data.name = 'Edited';
    await writeFsaProjectPackage(fs.root, session, data);
    expect(fs.writes.slice(before)).toEqual(['Terrain.msproj']);
    await expect(decodeProjectPackage(fs.files.get('Terrain.msproj')!)).rejects.toThrow('linked media folder');
  });
  it('does not replace the project if a geometry write fails', async () => {
    const data = project(); const fs = filesystem(true);
    await expect(writeFsaProjectPackage(fs.root, ProjectPackageSession.create(data), data)).rejects.toThrow('disk full');
    expect(fs.files.has('Terrain.msproj')).toBe(false);
  });
});
