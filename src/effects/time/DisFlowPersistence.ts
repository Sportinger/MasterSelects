import { projectFileService } from '../../services/projectFileService';
import { readMediaSourceFingerprint } from '../../services/project/mediaSourceValidation';
import type { ResidentMotionFrames } from './residentMotionFrames';
import { Logger } from '../../services/logger';

const log = Logger.create('DisPersistence');

// Increment whenever DIS shaders, preprocessing, confidence or storage units change.
export const DIS_CACHE_VERSION = 'dis-source-uv-v2-coarse-seed';
const textEncoder = new TextEncoder();
const digest = async (bytes: Uint8Array<ArrayBuffer>) => Array.from(new Uint8Array(
  await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2,'0')).join('');

/** Durable cache references live in project Analysis; large binary pairs stay
 * alongside the linked media under Cache/motion. No runtime handle is serialized.
 */
export class DisFlowPersistence {
  private readonly isCurrentProject: () => boolean;
  readonly key: string;
  private readonly width: number;
  private readonly height: number;
  private referenceName = '';
  private reference = '';
  private linked?: Promise<boolean>;
  private constructor(isCurrentProject: () => boolean, key: string, width: number, height: number) {
    this.isCurrentProject=isCurrentProject; this.key=key; this.width=width; this.height=height;
  }

  static async open(snapshot: ResidentMotionFrames): Promise<DisFlowPersistence | undefined> {
    const project = projectFileService.getProjectData();
    const handle = projectFileService.getProjectHandle();
    const path = projectFileService.getProjectPath();
    const current = () => !!projectFileService.getProjectData()
      && projectFileService.getProjectHandle() === handle && projectFileService.getProjectPath() === path;
    const source = snapshot.cacheSource;
    if (!project || !source || (!handle && !path)) return;
    const fingerprint = source.file ? await readMediaSourceFingerprint(source.file) : source.fileHash;
    if (!fingerprint || !current()) return;
    const identity = { version: DIS_CACHE_VERSION, sourceFingerprint: fingerprint,
      sourceSize: source.file?.size, sourceModified: source.file?.lastModified,
      width: snapshot.width, height: snapshot.height, stabilization: source.stabilization ?? null };
    const key = await digest(textEncoder.encode(JSON.stringify(identity)));
    if (!current()) return;
    const cache = new DisFlowPersistence(current, key, snapshot.width, snapshot.height);
    cache.referenceName = `dis-${source.mediaId.replace(/[^a-zA-Z0-9_-]/g,'_')}-${key}.json`;
    cache.reference = JSON.stringify({ ...identity,
        mediaId: source.mediaId, key, folderKey: 'CACHE_MOTION', format: 'rgba16float',
        units: 'uv-per-source-second', pattern: `${key}.{sourcePTS}.{targetPTS}.{direction}.dis` });
    return cache;
  }

  private ensureLinked(): Promise<boolean> {
    return this.linked ??= (async () => {
      const started = performance.now();
      if (!this.current()) return false;
      if (await projectFileService.readFile('ANALYSIS', this.referenceName)) return true;
      if (!this.current()) return false;
      const written = await projectFileService.writeFile('ANALYSIS', this.referenceName, this.reference);
      log.info('DIS project reference saved', { ms: Math.round(performance.now()-started), written });
      return written;
    })();
  }

  private current(): boolean { return this.isCurrentProject(); }
  private name(time: number, target: number, reverse: boolean): string {
    if (!Number.isFinite(time) || !Number.isFinite(target)) throw new Error('Invalid DIS source PTS.');
    return `${this.key}.${time}.${target}.${reverse ? 'backward' : 'forward'}.dis`;
  }

  async read(time: number, target: number, reverse: boolean): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (!this.current()) return;
    try {
      const file = await projectFileService.readFile('CACHE_MOTION', this.name(time,target,reverse));
      const expected = this.width*this.height*8;
      if (!file || file.size < expected+8 || file.size > expected+4096 || !this.current()) return;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const view = new DataView(bytes.buffer);
      if (view.getUint32(0,true) !== 0x32534944) return;
      const offset = 8+view.getUint32(4,true);
      if (offset<8 || offset>4096 || bytes.length-offset!==expected) return;
      const metadata = JSON.parse(new TextDecoder().decode(bytes.subarray(8,offset)));
      const data = bytes.slice(offset);
      if (metadata.key!==this.key || metadata.time!==time || metadata.target!==target || metadata.reverse!==reverse
        || metadata.checksum!==await digest(data) || !this.current()) return;
      return data;
    } catch { return; } // Partial/corrupt/missing files are recomputed, never displayed.
  }

  async write(time: number, target: number, reverse: boolean, data: Uint8Array<ArrayBuffer>): Promise<boolean> {
    if (!this.current() || data.byteLength!==this.width*this.height*8) return false;
    const started = performance.now();
    const metadata = textEncoder.encode(JSON.stringify({ key:this.key,time,target,reverse,checksum:await digest(data) }));
    const hashed = performance.now();
    if (!this.current()) return false;
    const header = new ArrayBuffer(8), view = new DataView(header);
    view.setUint32(0,0x32534944,true); view.setUint32(4,metadata.byteLength,true);
    // The small reference may rewrite a packaged project once. It must neither
    // serialize every binary write nor hold up source-pair analysis.
    const fileWrite = projectFileService.writeFile('CACHE_MOTION',this.name(time,target,reverse),new Blob([header,metadata,data]))
      .then(written => {
        log.info('DIS field file saved', { time, target, reverse, bytes: data.byteLength,
          checksumMs: Math.round(hashed-started), fileMs: Math.round(performance.now()-hashed), written });
        return written;
      });
    const [written,linked] = await Promise.all([fileWrite,this.ensureLinked()]);
    return written && linked;
  }
}
