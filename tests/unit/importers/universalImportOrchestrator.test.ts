import { describe, expect, it } from 'vitest';
import {
  BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  BUILTIN_CSV_IMPORTER_ID,
  createDefaultUniversalImportOrchestrator,
} from '../../../src/importers';

const fixedNow = () => '2026-05-24T00:00:00.000Z';

function textFromPayload(bytes: ArrayBuffer): string {
  return new TextDecoder().decode(bytes);
}

describe('UniversalImportOrchestrator', () => {
  it('imports CSV files as table SignalAssets through provider discovery', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const file = new File(['x,y,label\n1,2,A\n3,4,B\n'], 'DATA.CSV', { type: 'text/csv; charset=utf-8' });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.provider.id).toBe(BUILTIN_CSV_IMPORTER_ID);
    expect(result.policyDecision.allowed).toBe(true);
    expect(result.discovery.discoveredProviders.map((provider) => provider.id)).toEqual([
      BUILTIN_CSV_IMPORTER_ID,
      BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
    ]);
    expect(result.asset).toMatchObject({
      schemaVersion: 1,
      name: 'DATA.CSV',
      source: {
        kind: 'file',
        extension: 'csv',
        mimeType: 'text/csv',
        providerId: BUILTIN_CSV_IMPORTER_ID,
      },
      metadata: {
        importerRoute: 'signal',
        providerId: BUILTIN_CSV_IMPORTER_ID,
        rowCount: 2,
        columnCount: 3,
      },
    });

    const tableRef = result.asset.refs.find((ref) => ref.kind === 'table');
    expect(tableRef).toMatchObject({
      kind: 'table',
      mimeType: 'application/json',
      metadata: {
        rowCount: 2,
        columnCount: 3,
      },
    });
    expect(result.asset.refs.map((ref) => ref.kind).toSorted()).toEqual(['binary', 'metadata', 'table']);
    expect(result.asset.artifacts.map((artifact) => artifact.encoding).toSorted()).toEqual(['csv', 'table-records']);

    const tablePayload = result.artifactPayloads.find((payload) => payload.artifact.encoding === 'table-records');
    expect(tablePayload).toBeDefined();
    const parsedTable = JSON.parse(textFromPayload(tablePayload!.bytes)) as {
      columns: Array<{ name: string; type: string }>;
      rows: Array<Record<string, string>>;
      rowCount: number;
    };
    expect(parsedTable.columns.map((column) => [column.name, column.type])).toEqual([
      ['x', 'number'],
      ['y', 'number'],
      ['label', 'string'],
    ]);
    expect(parsedTable.rows).toEqual([
      { x: '1', y: '2', label: 'A' },
      { x: '3', y: '4', label: 'B' },
    ]);
  });

  it('imports unknown files as binary SignalAssets instead of rejecting them', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({
      now: fixedNow,
      legacyClassifier: async () => 'unknown',
    });
    const file = new File([new Uint8Array([0, 1, 2, 255])], 'capture.weird', {
      type: '',
      lastModified: 123,
    });

    const result = await orchestrator.importFile(file);

    expect(result.route).toBe('signal');
    if (result.route !== 'signal') throw new Error('Expected signal import');

    expect(result.provider.id).toBe(BUILTIN_BINARY_FALLBACK_IMPORTER_ID);
    expect(result.asset).toMatchObject({
      name: 'capture.weird',
      source: {
        kind: 'file',
        extension: 'weird',
        mimeType: 'application/octet-stream',
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
      metadata: {
        importerRoute: 'binary-fallback',
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
    });
    expect(result.asset.refs.map((ref) => ref.kind).toSorted()).toEqual(['binary', 'metadata']);
    expect(result.asset.artifacts).toHaveLength(1);
    expect(result.asset.artifacts[0]).toMatchObject({
      encoding: 'raw',
      mimeType: 'application/octet-stream',
      size: 4,
      storage: { kind: 'memory' },
      producer: {
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
    });
    expect(result.asset.artifacts[0]!.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(new Uint8Array(result.artifactPayloads[0]!.bytes)).toEqual(new Uint8Array([0, 1, 2, 255]));
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        severity: 'info',
        code: 'binary.fallback',
      }),
    ]);
  });

  it('classifies existing media imports as legacy route without converting them', async () => {
    const orchestrator = createDefaultUniversalImportOrchestrator({ now: fixedNow });
    const file = new File(['not-real-video'], 'clip.mp4', { type: 'video/mp4' });

    const plan = await orchestrator.planImport(file);

    expect(plan.route).toBe('legacy-media');
    if (plan.route !== 'legacy-media') throw new Error('Expected legacy route');

    expect(plan.legacyMediaType).toBe('video');
    expect(plan.discovery.discoveredProviders.map((provider) => provider.id)).toEqual([
      BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
    ]);
  });
});
