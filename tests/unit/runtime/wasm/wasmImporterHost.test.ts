import { describe, expect, it } from 'vitest';
import { WasmImporterHost, createWasmImporterAdapter } from '../../../../src/runtime/wasm';
import * as csvBinaryImporter from '../../../../src/runtime/wasm/fixtures/csvBinaryImporter';

const encoder = new TextEncoder();

describe('WasmImporterHost', () => {
  it('wraps nested jco-style importer exports and normalizes WIT result shapes', async () => {
    const moduleLike = {
      default: {
        importer: {
          'can-import': (fileName: string, mimeType: string, header: Uint8Array) => (
            fileName.endsWith('.bin') &&
            mimeType === 'application/octet-stream' &&
            header.byteLength === 3
          ),
          'import-file': () => ({
            tag: 'ok',
            val: {
              signals: [
                {
                  id: 'fixture:binary',
                  kind: 'binary',
                  artifact: {
                    id: 'artifact:fixture',
                    hash: 'sha256:fixture',
                    'mime-type': 'application/octet-stream',
                    size: BigInt(3),
                  },
                  'metadata-json': '{"byteLength":3}',
                },
              ],
              'diagnostics-json': '{"ok":true}',
            },
          }),
        },
      },
    };

    const host = WasmImporterHost.fromModule(moduleLike, {
      providerId: 'fixture.nested',
      providerVersion: '0.1.0',
      moduleName: 'nested-jco-fixture',
    });

    await expect(host.canImport({
      fileName: 'sample.bin',
      mimeType: 'application/octet-stream',
      header: new Uint8Array([1, 2, 3]),
    })).resolves.toBe(true);

    const result = await host.importFile({
      fileName: 'sample.bin',
      mimeType: 'application/octet-stream',
      bytes: new Uint8Array([1, 2, 3]),
    });

    expect(result).toMatchObject({
      providerId: 'fixture.nested',
      providerVersion: '0.1.0',
      diagnostics: { ok: true },
      signals: [
        {
          id: 'fixture:binary',
          kind: 'binary',
          artifact: {
            id: 'artifact:fixture',
            hash: 'sha256:fixture',
            mimeType: 'application/octet-stream',
            size: 3,
          },
          metadataJson: '{"byteLength":3}',
        },
      ],
    });
    expect(host.getModuleName()).toBe('nested-jco-fixture');
  });

  it('fails closed when a module has no importer exports', () => {
    expect(() => createWasmImporterAdapter({ default: {} })).toThrow('canImport/importFile');
  });

  it('imports real CSV bytes through the jco-compatible TypeScript fixture', async () => {
    const host = WasmImporterHost.fromModule(csvBinaryImporter, {
      providerId: csvBinaryImporter.manifest.id,
      providerVersion: csvBinaryImporter.manifest.version,
    });
    const bytes = encoder.encode('name,count,active\nalpha,2,true\nbeta,3,false\n');

    await expect(host.canImport({
      fileName: 'metrics.csv',
      mimeType: 'text/csv',
      header: bytes.slice(0, 24),
    })).resolves.toBe(true);

    const result = await host.importFile({
      fileName: 'metrics.csv',
      mimeType: 'text/csv',
      bytes,
    });

    const tableSignal = result.signals.find((signal) => signal.kind === 'table');
    const metadataSignal = result.signals.find((signal) => signal.kind === 'metadata');
    expect(tableSignal).toBeDefined();
    expect(metadataSignal).toBeDefined();
    expect(tableSignal?.artifact?.hash).toMatch(/^(sha256|fnv1a32):/);
    expect(result.diagnostics).toMatchObject({
      importer: csvBinaryImporter.manifest.id,
      format: 'csv',
      signalCount: 2,
      byteLength: bytes.byteLength,
    });

    const metadata = JSON.parse(tableSignal?.metadataJson ?? '{}');
    expect(metadata).toMatchObject({
      format: 'csv',
      rowCount: 2,
      columnCount: 3,
      columns: ['name', 'count', 'active'],
    });
    expect(metadata.columnTypes).toEqual([
      { name: 'name', type: 'string' },
      { name: 'count', type: 'number' },
      { name: 'active', type: 'boolean' },
    ]);
  });

  it('imports arbitrary binary bytes as a binary SignalRef manifest', async () => {
    const host = WasmImporterHost.fromModule(csvBinaryImporter);
    const bytes = new Uint8Array([0, 255, 16, 32, 48]);

    const result = await host.importFile({
      fileName: 'capture.dat',
      mimeType: 'application/octet-stream',
      bytes,
    });

    const binarySignal = result.signals.find((signal) => signal.kind === 'binary');
    expect(binarySignal?.artifact).toMatchObject({
      mimeType: 'application/octet-stream',
      size: bytes.byteLength,
    });
    expect(JSON.parse(binarySignal?.metadataJson ?? '{}')).toMatchObject({
      format: 'binary',
      fileName: 'capture.dat',
      byteLength: bytes.byteLength,
      headerHex: '00 ff 10 20 30',
    });
  });
});
