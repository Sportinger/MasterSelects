// TEMPORARY diagnostic (claude session masterselects-public-41). Delete after diagnosis. Read-only.
import { existsSync, promises as fs } from 'node:fs';
import nodePath from 'node:path';
import { it } from 'vitest';
import type { RepositoryBackend, RepositoryDescriptor } from '../../src/services/project/repository/contracts';
import { RepositoryError } from '../../src/services/project/repository/contracts';
import { recoverRepository } from '../../src/services/project/repository/persistence/recovery';
import { materializeProjection } from '../../src/services/project/repository/persistence/projection';

const ROOT = 'E:/MS UTE 22 (converted)';
async function walk(dir: string, base = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = base + entry.name;
    if (entry.isDirectory()) out.push(...await walk(nodePath.join(dir, entry.name), rel + '/')); else out.push(rel);
  }
  return out;
}
// Local-only: skips cleanly on machines without the converted project on disk.
it.skipIf(!existsSync(nodePath.join(ROOT, 'project.msrepo.json')))('measures worker-side open cost', async () => {
  let reads = 0, lists = 0;
  const full = (path: string) => nodePath.join(ROOT, ...path.split('/'));
  const backend = { locationId: 'diag', capabilities: { rangeReads: true, immutableWrites: false, replaceViewSlots: false, ownership: false, durability: 'stream-close' },
    async acquireOwner() { return null; },
    async list(prefix: string, cursor?: string, limit = 128) { lists++; const top = prefix.split('/').slice(0, -1).join('/'); let names: string[] = []; try { names = (await walk(nodePath.join(ROOT, top), top ? top + '/' : '')).filter(p => p.startsWith(prefix) && (!cursor || p > cursor)).toSorted(); } catch { names = []; } const paths = names.slice(0, limit); return { paths, nextCursor: names.length > limit ? paths.at(-1)! : null }; },
    async read(path: string, offset = 0, length?: number) { reads++; const h = await fs.open(full(path), 'r'); try { const size = (await h.stat()).size; const n = Math.max(0, Math.min(length ?? size - offset, size - offset)); const b = new Uint8Array(n); await h.read(b, 0, n, offset); return b; } finally { await h.close(); } },
    async stat(path: string) { try { const s = await fs.stat(full(path)); return s.isFile() ? { length: s.size } : null; } catch { return null; } },
    async writeNew() { throw new RepositoryError('permission', 'read-only diag'); }, async replaceViewSlot() { throw new RepositoryError('permission', 'read-only diag'); }, async removeUnpublished() { throw new RepositoryError('permission', 'read-only diag'); },
  } as unknown as RepositoryBackend;
  const descriptor = JSON.parse(await fs.readFile(full('project.msrepo.json'), 'utf8')) as RepositoryDescriptor;
  let t = performance.now();
  const recovered = await recoverRepository(backend, descriptor);
  console.log('[OPEN] recovery ms', Math.round(performance.now() - t), 'reads', reads, 'lists', lists, 'commits', recovered.operationSequence, 'checkpoints', recovered.checkpoints.length);
  t = performance.now(); reads = 0;
  const projection = await materializeProjection(backend, recovered.heads.content, recovered.checkpoints);
  console.log('[OPEN] projection ms', Math.round(performance.now() - t), 'reads', reads, 'entities', projection.entities.size);
  const views = (await walk(full('.masterselects/views'))).length;
  console.log('[OPEN] view files', views);
}, 600_000);
