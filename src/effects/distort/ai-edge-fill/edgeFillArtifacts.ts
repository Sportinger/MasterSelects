import type { ByteTextureUpload } from '../../_shared/byteTexture';
import type { ArtifactStore } from '../../../artifacts/ArtifactStore';

async function storage(): Promise<ArtifactStore> {
  const [{ artifactService }, { projectFileService }] = await Promise.all([
    import('../../../services/project/domains/ArtifactService'),
    import('../../../services/project/ProjectFileService'),
  ]);
  const handle = projectFileService.getProjectHandle();
  return handle ? artifactService.createStore(handle) : artifactService.createIndexedDBStore();
}

/** Bounded decoded pixels live here; project params contain only immutable artifact references. */
class EdgeFillArtifacts {
  private readonly ready = new Map<string, ByteTextureUpload>();
  private readonly pending = new Set<string>();
  private readonly errors = new Map<string, string>();
  private bytes = 0;
  private revision = 0;
  private readonly listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  error(ref: string): string | undefined { return this.errors.get(ref); }
  get(ref: string): ByteTextureUpload | null {
    if (!ref) return null;
    const hit = this.ready.get(ref);
    if (hit) { this.ready.delete(ref); this.ready.set(ref, hit); return hit; }
    if (!this.pending.has(ref) && !this.errors.has(ref)) {
      this.pending.add(ref);
      void this.load(ref).catch(error => { this.errors.set(ref, String(error)); }).finally(() => {
        this.pending.delete(ref); this.emit();
        void import('../../../services/render/renderHostPort').then(({ renderHostPort }) => renderHostPort.requestRender()).catch(() => undefined);
      });
    }
    return null;
  }
  retry(ref: string): void { this.errors.delete(ref); this.get(ref); this.emit(); }
  async save(blob: Blob, store: ArtifactStore, signature: string, aspect?: number): Promise<string> {
    const decoded = await this.decode(blob);
    if (aspect && Math.abs(decoded.upload.width / decoded.upload.height / aspect - 1) > .02) {
      throw new Error('The generated image changed the framing/aspect ratio. Discard this task and regenerate.');
    }
    const { manifest } = await store.putArtifact(decoded.blob, {
      mimeType: 'image/png', retention: 'required', producer: { providerId: 'kie.nano-banana-pro' },
      metadata: { kind: 'ai-edge-fill', sourceSignature: signature },
    });
    this.cache(manifest.artifactId, decoded.upload); this.emit();
    return manifest.artifactId;
  }
  private async load(ref: string): Promise<void> {
    const stored = await (await storage()).getArtifact(ref);
    if (!stored) throw new Error('Saved fill image is missing. Restore the project artifact or regenerate.');
    this.cache(ref, (await this.decode(stored.blob)).upload);
  }
  private async decode(blob: Blob): Promise<{ blob: Blob; upload: ByteTextureUpload }> {
    let bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, 4096 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    if (scale < 1) {
      const resized = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' });
      bitmap.close(); bitmap = resized;
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('Fill image decoder unavailable.');
      context.drawImage(bitmap, 0, 0);
      const data = new Uint8Array(context.getImageData(0, 0, width, height).data.buffer);
      const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Fill encoding failed.')), 'image/png'));
      return { blob: png, upload: { data, width, height, version: '' } };
    } finally { bitmap.close(); canvas.width = canvas.height = 0; }
  }
  private cache(ref: string, upload: ByteTextureUpload): void {
    if (this.ready.has(ref)) this.bytes -= this.ready.get(ref)!.data.byteLength;
    this.ready.delete(ref);
    while (this.bytes + upload.data.byteLength > 128 * 1024 * 1024 && this.ready.size) {
      const oldest = this.ready.keys().next().value!;
      this.bytes -= this.ready.get(oldest)!.data.byteLength; this.ready.delete(oldest);
    }
    this.ready.set(ref, { ...upload, version: ref }); this.bytes += upload.data.byteLength;
    this.errors.delete(ref);
  }
  private emit(): void { this.revision++; this.listeners.forEach(listener => listener()); }
}
export const edgeFillArtifacts: EdgeFillArtifacts = import.meta.hot?.data?.edgeFillArtifacts ?? new EdgeFillArtifacts();
// Retain pending work/pixels across HMR while accepting updated owner methods.
Object.setPrototypeOf(edgeFillArtifacts, EdgeFillArtifacts.prototype);
if (import.meta.hot) import.meta.hot.dispose(data => { data.edgeFillArtifacts = edgeFillArtifacts; });
