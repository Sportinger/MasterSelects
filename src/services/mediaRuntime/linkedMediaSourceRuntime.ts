interface LinkedMediaRuntimeEntry {
  file: File;
  handle?: FileSystemFileHandle;
}

export type ActiveMediaRuntimeSource =
  | { kind: 'original' }
  | { kind: 'linked'; sourceId: string };

class LinkedMediaSourceRuntime {
  private originals = new Map<string, LinkedMediaRuntimeEntry>();
  private linked = new Map<string, LinkedMediaRuntimeEntry>();
  private active = new Map<string, ActiveMediaRuntimeSource>();

  rememberOriginal(mediaId: string, entry: LinkedMediaRuntimeEntry): void {
    if (!this.originals.has(mediaId)) this.originals.set(mediaId, entry);
  }

  getOriginal(mediaId: string): LinkedMediaRuntimeEntry | undefined {
    return this.originals.get(mediaId);
  }

  setLinked(mediaId: string, sourceId: string, entry: LinkedMediaRuntimeEntry): void {
    this.linked.set(this.key(mediaId, sourceId), entry);
  }

  getLinked(mediaId: string, sourceId: string): LinkedMediaRuntimeEntry | undefined {
    return this.linked.get(this.key(mediaId, sourceId));
  }

  setActive(mediaId: string, source: ActiveMediaRuntimeSource): void {
    this.active.set(mediaId, source);
  }

  getActive(mediaId: string): ActiveMediaRuntimeSource | undefined {
    return this.active.get(mediaId);
  }

  clearActive(mediaId: string): void {
    this.active.delete(mediaId);
  }

  clear(): void {
    this.originals.clear();
    this.linked.clear();
    this.active.clear();
  }

  private key(mediaId: string, sourceId: string): string {
    return `${mediaId}:${sourceId}`;
  }
}

type HotData = { linkedMediaSourceRuntime?: LinkedMediaSourceRuntime };
const hotData = import.meta.hot?.data as HotData | undefined;

export const linkedMediaSourceRuntime = hotData?.linkedMediaSourceRuntime
  ?? new LinkedMediaSourceRuntime();

interface LinkedSourceProxyCandidate {
  id: string;
  linkedSources?: Array<{ id: string; role: 'proxy' | 'alternate' }>;
  sourceSelection?: { mode: 'auto' | 'original' } | { mode: 'linked'; sourceId: string };
}

export function isExternalProxySourceActive(file: LinkedSourceProxyCandidate): boolean {
  const activeSource = linkedMediaSourceRuntime.getActive(file.id);
  const selectedSourceId = activeSource?.kind === 'linked'
    ? activeSource.sourceId
    : file.sourceSelection?.mode === 'linked'
      ? file.sourceSelection.sourceId
      : undefined;
  if (!selectedSourceId) return false;
  return file.linkedSources?.some(
    (source) => source.id === selectedSourceId && source.role === 'proxy',
  ) ?? false;
}

if (import.meta.hot) {
  import.meta.hot.dispose((data: HotData) => {
    data.linkedMediaSourceRuntime = linkedMediaSourceRuntime;
  });
}
