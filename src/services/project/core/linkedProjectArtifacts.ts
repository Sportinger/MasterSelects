/** Runtime access to immutable binaries stored beside a project package.
 * Keep their paths in the package without hydrating the entire analysis cache.
 */
export class LinkedProjectArtifacts {
  private readonly paths = new Set<string>();
  private reader: ((path: string) => Promise<Blob>) | null = null;

  configure(paths: Iterable<string>, reader: (path: string) => Promise<Blob>): void {
    this.paths.clear();
    for (const path of paths) this.paths.add(path);
    this.reader = reader;
  }

  snapshot(): ReadonlySet<string> { return new Set(this.paths); }
  has(path: string): boolean { return this.paths.has(path); }
  delete(path: string): boolean { return this.paths.delete(path); }

  async read(path: string): Promise<Blob | null> {
    if (!this.paths.has(path) || !this.reader) return null;
    try { return await this.reader(path); } catch { return null; }
  }

  /** Standalone packages embed binaries; normal saves retain external paths.
   * Materialize only for an explicit standalone encode, without keeping PCM
   * or other binary payloads resident in the project session afterwards.
   */
  async archiveEntries(entries: ReadonlyMap<string, Uint8Array>, external: ReadonlySet<string> = new Set()): Promise<ReadonlyMap<string, Uint8Array>> {
    const missing = [...this.paths].filter(path => !entries.has(path) && !external.has(path));
    if (!missing.length) return entries;
    const hydrated = new Map(entries);
    for (const path of missing) {
      const blob = await this.read(path);
      if (!blob) throw new Error(`Cannot read linked project artifact: ${path}`);
      hydrated.set(path, new Uint8Array(await blob.arrayBuffer()));
    }
    return hydrated;
  }
}
