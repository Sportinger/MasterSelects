import { RepositoryError, type JsonValue } from '../contracts';
import { canonicalJson } from '../segments/canonical';
interface LocalView { sequence: number; value: JsonValue; }
/** Reader preferences are origin-local, never mutations of the shared repository. */
export class ReadonlyWorkspace {
  private readonly values = new Map<string, LocalView>();
  private readonly namespace: string;
  constructor(namespace: string) {
    this.namespace = namespace;}
  private key(key: string) { return `masterselects.repository.reader:${encodeURIComponent(this.namespace)}:${encodeURIComponent(key)}`; }
  read(key: string): JsonValue | null {
    const cached = this.values.get(key); if (cached) return cached.value;
    try {
      const raw = localStorage.getItem(this.key(key)); if (!raw || raw.length > 1024 * 1024) return null;
      const value = JSON.parse(raw) as LocalView;
      if (!Number.isSafeInteger(value.sequence) || value.sequence < 0) return null;
      canonicalJson(value.value); this.values.set(key, value); return value.value;
    } catch { return null; }
  }
  write(key: string, value: JsonValue): number {
    const encoded = canonicalJson(value); if (encoded.length > 1024 * 1024 || !key || key.length > 256) throw new RepositoryError('budget', 'Reader workspace view exceeds bounds');
    this.read(key); const previous = this.values.get(key); const sequence = (previous?.sequence ?? 0) + 1;
    const next = { sequence, value: JSON.parse(encoded) as JsonValue };
    try { localStorage.setItem(this.key(key), canonicalJson(next)); } catch { /* RAM-only reader workspace. */ }
    this.values.set(key, next); return sequence;
  }
}
