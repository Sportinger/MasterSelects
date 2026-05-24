import { describe, expect, it } from 'vitest';
import {
  checkRuntimeCapabilities,
  isRuntimeCapability,
  normalizeRuntimeCapabilities,
  type RuntimeCapability,
} from '../../../src/runtime/capabilities';

describe('runtime capability policy', () => {
  it('normalizes known capabilities and drops malformed values', () => {
    expect(normalizeRuntimeCapabilities(['file.read', 'file.read', 'network.fetch', 'bad.capability'])).toEqual([
      'file.read',
      'network.fetch',
    ]);
    expect(isRuntimeCapability('artifact.write')).toBe(true);
    expect(isRuntimeCapability('bad.capability')).toBe(false);
  });

  it('allows a provider only when every requested capability is granted', () => {
    const decision = checkRuntimeCapabilities(
      { providerId: 'builtin.csv', granted: ['file.read', 'artifact.write'] },
      { providerId: 'builtin.csv', requested: ['file.read'] },
    );

    expect(decision.allowed).toBe(true);
  });

  it('fails closed for missing providers, mismatched providers, unknown capabilities, and missing grants', () => {
    expect(checkRuntimeCapabilities(undefined, {
      providerId: 'missing',
      requested: ['file.read'],
    }).allowed).toBe(false);

    expect(checkRuntimeCapabilities(
      { providerId: 'builtin.csv', granted: ['file.read'] },
      { providerId: 'other.provider', requested: ['file.read'] },
    ).allowed).toBe(false);

    expect(checkRuntimeCapabilities(
      { providerId: 'builtin.csv', granted: ['file.read'] },
      { providerId: 'builtin.csv', requested: ['bad.capability' as RuntimeCapability] },
    ).allowed).toBe(false);

    const denied = checkRuntimeCapabilities(
      { providerId: 'builtin.csv', granted: ['file.read'] },
      { providerId: 'builtin.csv', requested: ['file.read', 'artifact.write'] },
    );

    expect(denied.allowed).toBe(false);
    if (!denied.allowed) {
      expect(denied.missingCapabilities).toEqual(['artifact.write']);
    }
  });
});
