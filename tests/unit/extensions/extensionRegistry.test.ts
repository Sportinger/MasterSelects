import { describe, expect, it } from 'vitest';
import { ExtensionRegistry, type ExtensionProviderManifest } from '../../../src/extensions';

const csvImporter: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: 'builtin.csv',
  version: '0.1.0',
  displayName: 'CSV Importer',
  role: 'importer',
  runtime: 'worker',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    {
      extensions: ['.csv'],
      mimeTypes: ['text/csv'],
    },
  ],
  signals: {
    outputKinds: ['table', 'metadata'],
  },
};

describe('ExtensionRegistry', () => {
  it('registers providers and discovers importers by file signature', () => {
    const registry = new ExtensionRegistry([csvImporter]);

    expect(registry.get('builtin.csv')).toMatchObject({
      id: 'builtin.csv',
      capabilities: ['file.read', 'artifact.write'],
    });
    expect(registry.findImportersForFile({
      fileName: 'DATA.CSV',
      mimeType: 'text/csv; charset=utf-8',
    }).map((provider) => provider.id)).toEqual(['builtin.csv']);
    expect(registry.findImportersForFile({
      fileName: 'image.png',
      mimeType: 'image/png',
    })).toEqual([]);
  });

  it('queries providers by role, runtime, capability, and signal kind', () => {
    const registry = new ExtensionRegistry([csvImporter]);

    expect(registry.findProviders({
      role: 'importer',
      runtime: 'worker',
      outputKind: 'table',
      capability: 'artifact.write',
    }).map((provider) => provider.id)).toEqual(['builtin.csv']);

    expect(registry.findProviders({ outputKind: 'texture' })).toEqual([]);
  });

  it('fails closed for unknown providers and missing provider capabilities', () => {
    const registry = new ExtensionRegistry([csvImporter]);

    expect(registry.checkProviderCapabilities('missing.provider', ['file.read']).allowed).toBe(false);
    expect(registry.checkProviderCapabilities('builtin.csv', ['network.fetch']).allowed).toBe(false);
    expect(registry.checkProviderCapabilities('builtin.csv', ['file.read', 'artifact.write']).allowed).toBe(true);
  });

  it('rejects duplicate provider ids', () => {
    const registry = new ExtensionRegistry([csvImporter]);

    expect(() => registry.register(csvImporter)).toThrow('already registered');
  });
});
