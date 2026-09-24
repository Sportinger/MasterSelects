import { RotoSession } from './RotoSession';

interface RotoSource { key: string; scope: string; url: string; file?: Blob; from: number; to: number }
interface Entry { source: RotoSource; session: RotoSession; users: number }

/** Tab-lifetime masks outside project data. Never evict unfinished work silently. */
export class RotoSessions {
  private entries = new Map<string, Entry>();
  private budget: number;
  private scope?: string;
  constructor(budget = 256 * 1024 * 1024) { this.budget = budget; }
  get memoryBytes() { return [...this.entries.values()].reduce((sum, entry) => sum + entry.session.memoryBytes, 0); }
  acquire(source: RotoSource) {
    this.scope = source.scope;
    for (const [key, entry] of this.entries) {
      if (!entry.users && entry.source.scope !== source.scope) { entry.session.dispose(); this.entries.delete(key); }
    }
    let entry = this.entries.get(source.key);
    if (entry && (entry.source.scope !== source.scope || entry.source.file !== source.file || (!source.file && entry.source.url !== source.url)
      || entry.source.from !== source.from || entry.source.to !== source.to)) {
      if (entry.users) throw new Error('This clip is already open in another Roto panel.');
      entry.session.dispose(); this.entries.delete(source.key); entry = undefined;
    }
    if (!entry) {
      const session = new RotoSession(source.url, source.file, source.from, source.to, delta => {
        if (this.memoryBytes + delta > this.budget) throw new Error('Roto mask memory is full. Export and clear masks on another clip before tracking more frames.');
      });
      entry = { source, session, users: 0 }; this.entries.set(source.key, entry);
    }
    if (entry.users) throw new Error('This clip is already open in another Roto panel.');
    entry.users++;
    const held = entry; let released = false;
    return { session: held.session, release: () => {
      if (released) return;
      released = true; held.users--;
      if (!held.users) held.session.suspend();
      if (held.source.scope !== this.scope) { held.session.dispose(); this.entries.delete(held.source.key); }
    } };
  }
}
const hot = import.meta.hot?.data as { rotoSessions?: RotoSessions } | undefined;
export const rotoSessions = hot?.rotoSessions ?? new RotoSessions();
if (import.meta.hot) import.meta.hot.dispose(data => { data.rotoSessions = rotoSessions; });
