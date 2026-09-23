import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Blob as BinaryBlob } from 'node:buffer';
import type { ResidentMotionFrames } from '../../src/effects/time/residentMotionFrames';

const storage = vi.hoisted(() => ({ project: { name:'project-a', createdAt:'2026-09-23' }, files: new Map<string,Blob>() }));
vi.mock('../../src/services/projectFileService', () => ({ projectFileService: {
  getProjectData: () => storage.project, getProjectHandle: () => storage.project, getProjectPath: () => null,
  readFile: async (folder:string,name:string) => storage.files.get(`${folder}/${name}`) ?? null,
  writeFile: async (folder:string,name:string,data:Blob|string) => {
    storage.files.set(`${folder}/${name}`,typeof data==='string' ? new Blob([data]) : data); return true;
  },
} }));
vi.mock('../../src/services/project/mediaSourceValidation', () => ({ readMediaSourceFingerprint: async () => 'fingerprint' }));
import { DisFlowPersistence } from '../../src/effects/time/DisFlowPersistence';

const snapshot = () => ({ width:2,height:2,cacheSource:{mediaId:'source',fileHash:'source-hash'},identity:'runtime-only' } as ResidentMotionFrames);
describe('durable DIS source pairs', () => {
  beforeEach(() => {
    storage.project={name:'project-a',createdAt:'2026-09-23'}; storage.files.clear();
    vi.stubGlobal('crypto',webcrypto);
    // jsdom's Blob lacks arrayBuffer(); use the standard binary implementation.
    vi.stubGlobal('Blob',BinaryBlob);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('does not rewrite a packaged project before analysis can start', async () => {
    const cache = await DisFlowPersistence.open(snapshot());
    expect(cache).toBeDefined();
    expect(storage.files.size).toBe(0);
    await cache!.write(0,.04,false,new Uint8Array(32));
    expect([...storage.files.keys()].filter(name => name.startsWith('ANALYSIS/'))).toHaveLength(1);
  });
  it('restores exact forward/reverse data through a new owner, and rejects corrupted payloads', async () => {
    const writer = (await DisFlowPersistence.open(snapshot()))!;
    const data = Uint8Array.from({length:32},(_,i)=>i);
    expect(await writer.write(10.001,10.041,false,data)).toBe(true);
    expect(await writer.write(10.001,10.041,true,data.toReversed())).toBe(true);
    const restored = (await DisFlowPersistence.open({...snapshot(),identity:'another-atlas-and-playhead'}))!;
    expect(await restored.read(10.001,10.041,false)).toEqual(data);
    expect(await restored.read(10.001,10.041,true)).toEqual(data.toReversed());
    expect(await restored.read(10.001,10.042,false)).toBeUndefined();
    const key = [...storage.files.keys()].find(name=>name.endsWith('.forward.dis'))!;
    const corrupt = new Uint8Array(await storage.files.get(key)!.arrayBuffer());corrupt[corrupt.length-1]^=1;
    storage.files.set(key,new Blob([corrupt]));
    expect(await restored.read(10.001,10.041,false)).toBeUndefined();
  });
  it('invalidates source/analysis changes and prevents writes into a different project', async () => {
    const first = (await DisFlowPersistence.open(snapshot()))!;
    const resized = (await DisFlowPersistence.open({...snapshot(),width:4}))!;
    const stabilized = (await DisFlowPersistence.open({...snapshot(),cacheSource:{mediaId:'source',fileHash:'source-hash',stabilization:'revision-2'}}))!;
    const relinked = (await DisFlowPersistence.open({...snapshot(),cacheSource:{mediaId:'source',fileHash:'new-source'}}))!;
    expect(new Set([first.key,resized.key,stabilized.key,relinked.key]).size).toBe(4);
    storage.project={name:'project-b',createdAt:'2026-09-23'};
    expect(await first.write(0,.04,false,new Uint8Array(32))).toBe(false);
    expect(await first.read(0,.04,false)).toBeUndefined();
  });
});
