import { describe, expect, it } from 'vitest';
import type { RepositoryBackend, RepositoryDescriptor, RepositoryMetadataIndex, RepositoryOwner, RevisionPayload } from '../../src/services/project/repository/contracts';
import { RepositoryPersistence, type PublicationBatch } from '../../src/services/project/repository/persistence/RepositoryPersistence';
import { readStartupCache, startupCachePath } from '../../src/services/project/repository/persistence/startupCache';
import { commitPath } from '../../src/services/project/repository/persistence/publication';

const descriptor: RepositoryDescriptor = { format:'masterselects-repository',formatVersion:1,repositoryId:'cached-project',lineageId:'lineage',requiredReaderCapabilities:[],requiredWriterCapabilities:[] };
function fixture(){
 const files=new Map<string,Uint8Array>(),modified=new Map<string,number>(),metadata=new Map();let clock=0,reads=0;
 const owner:RepositoryOwner={writerEpoch:'writer',assertOwned(){},async release(){}};
 async function write(path:string,chunks:AsyncIterable<Uint8Array>){const parts=[];for await(const part of chunks)parts.push(part);const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}files.set(path,bytes);modified.set(path,++clock);}
 const backend:RepositoryBackend={locationId:'folder',capabilities:{rangeReads:true,immutableWrites:true,replaceViewSlots:true,ownership:true,durability:'stream-close'},
  async acquireOwner(){return owner},async stat(path){const bytes=files.get(path);return bytes?{length:bytes.length,modifiedTime:modified.get(path)}:null},
  async read(path,offset=0,length){reads++;const bytes=files.get(path);if(!bytes)throw new Error('Missing file');return bytes.slice(offset,length===undefined?undefined:offset+length)},
  async list(prefix,cursor,limit=128){const paths=[...files.keys()].filter(p=>p.startsWith(prefix)&&(!cursor||p>cursor)).toSorted();return {paths:paths.slice(0,limit),nextCursor:paths.length>limit?paths[limit-1]:null}},
  writeNew:write,replaceViewSlot:write,async removeUnpublished(path){files.delete(path)} };
 const index={async getMetadata(key:string){return metadata.get(key)??null},async putMetadata(key:string,value:unknown){metadata.set(key,value)},async removeMetadata(key:string){metadata.delete(key)},async putRevision(){}} as unknown as RepositoryMetadataIndex;
 const writer=()=>new RepositoryPersistence(backend,descriptor,owner,{sessionEpoch:'session',index});
 return {files,modified,metadata,backend,index,writer,reads:()=>reads};
}
function batch(sequence:number,parent: {reference: import('../../src/services/project/repository/contracts').RecordReference; id:string}|null=null):PublicationBatch{
 return {batchId:'batch-'+sequence,firstOperation:sequence,lastOperation:sequence,heads:{content:'revision'},records:[{
  id:'revision',build:()=>({kind:'revision',schemaVersion:1,payload:{revisionId:'revision-'+sequence,transactionId:'tx-'+sequence,parent:parent?.reference??null,parentRevisionId:parent?.id??null,label:'Edit',source:'test',createdAt:sequence,changes:[]} as unknown as RevisionPayload as never,references:parent?[parent.reference]:[],blobs:[]})}]};
}
describe('automatic project startup cache',()=>{
 it('saves beside the project, reuses validated history, and still includes unsnapshotted newer edits',async()=>{
  const f=fixture(),writer=f.writer();await writer.recover();let previous=null,last;
  for(let i=1;i<=20;i++){last=await writer.publish(batch(i,previous));previous={reference:last.records.get('revision')!,id:'revision-'+i};}
  await writer.saveStartupCache();expect(f.files.has(startupCachePath('a'))).toBe(true);
  const coldReads=f.reads(),reopened=f.writer(),opened=await reopened.recover();
  expect(opened.operationSequence).toBe(20);expect(f.reads()-coldReads).toBeLessThan(10);
  last=await reopened.publish(batch(21,previous));
  const newer=await f.writer().recover();expect(newer.operationSequence).toBe(21);expect(newer.head).toEqual(last.reference);
 });
 it('rejects changed immutable bytes, copied cache attestations, and truncated slots',async()=>{
  const f=fixture(),writer=f.writer();await writer.recover();const first=await writer.publish(batch(1));await writer.saveStartupCache();
  expect(await readStartupCache(f.backend,descriptor,f.index)).not.toBeNull();
  f.modified.set(commitPath(first.commit.commitId),999);expect(await readStartupCache(f.backend,descriptor,f.index)).toBeNull();
  await writer.saveStartupCache(); // Same state does not rewrite every repeated flush.
  f.files.set(startupCachePath('a'),Uint8Array.of(1));expect(await readStartupCache(f.backend,descriptor,f.index)).toBeNull();
  f.metadata.clear();expect(await readStartupCache(f.backend,descriptor,f.index)).toBeNull();
 });
 it('retains the prior complete slot after an interrupted cache write',async()=>{
  const f=fixture(),writer=f.writer();await writer.recover();const one=await writer.publish(batch(1));await writer.saveStartupCache();
  await writer.publish(batch(2,{reference:one.records.get('revision')!,id:'revision-1'}));await writer.saveStartupCache();
  f.files.set(startupCachePath('b'),Uint8Array.of(0));
  expect((await f.writer().recover()).operationSequence).toBe(2);
 });
 it('falls back to full recovery for a new fork at old ancestry',async()=>{
  const f=fixture(),writer=f.writer();await writer.recover();const one=await writer.publish(batch(1));
  const two=await writer.publish(batch(2,{reference:one.records.get('revision')!,id:'revision-1'}));await writer.saveStartupCache();
  const competing={...two.commit,commitId:'competing',batchId:'competing'};
  const {canonicalBytes}=await import('../../src/services/project/repository/segments/canonical');
  f.files.set(commitPath('competing'),canonicalBytes(competing));f.modified.set(commitPath('competing'),99);
  expect(await readStartupCache(f.backend,descriptor,f.index)).toBeNull();
  await expect(f.writer().recover()).rejects.toThrow('Divergent complete commits');
 });
});
