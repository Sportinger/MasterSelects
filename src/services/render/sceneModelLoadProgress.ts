export interface SceneModelLoadState {
  id: number;
  url: string;
  name: string;
  state: 'loading' | 'error';
  updatedAt: number;
}

class SceneModelLoadProgress {
  private nextId = 0;
  private entries = new Map<number, SceneModelLoadState>();

  begin(url: string, name: string): (failed?: boolean) => void {
    this.snapshot();
    for (const [key, entry] of this.entries) {
      if (entry.state === 'error' && (entry.url === url || this.entries.size >= 64)) this.entries.delete(key);
    }
    const id = ++this.nextId;
    this.entries.set(id, { id, url, name, state: 'loading', updatedAt: Date.now() });
    let finished = false;
    return (failed = false) => {
      if (finished) return;
      finished = true;
      if (failed) this.entries.set(id, { id, url, name, state: 'error', updatedAt: Date.now() });
      else this.entries.delete(id);
    };
  }

  snapshot(): SceneModelLoadState[] {
    const now = Date.now();
    for (const [id, entry] of this.entries) {
      if (entry.state === 'error' && now - entry.updatedAt > 10000) this.entries.delete(id);
    }
    return [...this.entries.values()];
  }
}

// Runtime-only service; model URLs and active requests never enter project stores.
export const sceneModelLoadProgress: SceneModelLoadProgress =
  import.meta.hot?.data?.sceneModelLoadProgress ?? new SceneModelLoadProgress();
import.meta.hot?.dispose?.(data => { data.sceneModelLoadProgress = sceneModelLoadProgress; });
