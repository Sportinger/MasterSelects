import type { ExtensionProviderManifest } from '../../extensions';
import { normalizeSignalAsset } from '../../signals';
import {
  cloneArrayBuffer,
  createSignalArtifactId,
  getFileExtension,
  guessMimeType,
  uint8ArrayToArrayBuffer,
} from '../fileIdentity';
import { sha256ArrayBuffer } from '../hash';
import type { BuiltinSignalImportProvider, SignalImportArtifactPayload } from '../types';
import { parseCsv } from '../csv';

export const BUILTIN_CSV_IMPORTER_ID = 'masterselects.import.csv';

export const builtinCsvImporterManifest: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: BUILTIN_CSV_IMPORTER_ID,
  version: '0.1.0',
  displayName: 'CSV Signal Importer',
  role: 'importer',
  runtime: 'builtin',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    { extensions: ['csv'] },
    { mimeTypes: ['text/csv', 'application/csv', 'application/vnd.ms-excel'] },
  ],
  signals: {
    outputKinds: ['table', 'metadata', 'binary'],
  },
  metadata: {
    importPriority: 100,
  },
};

export const builtinCsvImporter: BuiltinSignalImportProvider = {
  manifest: builtinCsvImporterManifest,
  requiredCapabilities: ['file.read', 'artifact.write'],
  importFile: async ({ file, fileBytes, assetId, now, absolutePath }) => {
    const createdAt = now();
    const mimeType = guessMimeType(file, 'text/csv');
    const sourceHash = await sha256ArrayBuffer(fileBytes);
    const sourceArtifactId = createSignalArtifactId(assetId, 'source');
    const tableArtifactId = createSignalArtifactId(assetId, 'table-records');
    const text = new TextDecoder().decode(fileBytes);
    const table = parseCsv(text);
    const tableBytes = uint8ArrayToArrayBuffer(new TextEncoder().encode(JSON.stringify({
      schemaVersion: 1,
      format: 'masterselects.table-records',
      sourceFileName: file.name,
      columns: table.columns,
      rows: table.rows,
      rowCount: table.rowCount,
      delimiter: table.delimiter,
    }, null, 2)));
    const tableHash = await sha256ArrayBuffer(tableBytes);

    const tableRefId = `${assetId}:table`;
    const metadataRefId = `${assetId}:metadata`;
    const binaryRefId = `${assetId}:binary`;
    const asset = normalizeSignalAsset({
      id: assetId,
      name: file.name,
      source: {
        kind: 'file',
        fileName: file.name,
        extension: getFileExtension(file.name),
        mimeType,
        size: file.size,
        hash: sourceHash,
        absolutePath,
        providerId: BUILTIN_CSV_IMPORTER_ID,
      },
      refs: [
        {
          id: tableRefId,
          kind: 'table',
          artifactId: tableArtifactId,
          mimeType: 'application/json',
          metadata: {
            rowCount: table.rowCount,
            columnCount: table.columns.length,
            columns: table.columns.map((column) => ({
              name: column.name,
              type: column.type,
              emptyCount: column.emptyCount,
            })),
            delimiter: table.delimiter,
          },
        },
        {
          id: metadataRefId,
          kind: 'metadata',
          metadata: {
            sourceArtifactId,
            tableArtifactId,
            diagnostics: table.diagnostics,
          },
        },
        {
          id: binaryRefId,
          kind: 'binary',
          artifactId: sourceArtifactId,
          mimeType,
        },
      ],
      artifacts: [
        {
          artifactId: sourceArtifactId,
          hash: sourceHash,
          size: fileBytes.byteLength,
          mimeType,
          encoding: 'csv',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_CSV_IMPORTER_ID,
            providerVersion: builtinCsvImporterManifest.version,
          },
          sourceRefs: [binaryRefId],
          createdAt,
          metadata: {
            role: 'source',
            fileName: file.name,
            lastModified: file.lastModified,
          },
        },
        {
          artifactId: tableArtifactId,
          hash: tableHash,
          size: tableBytes.byteLength,
          mimeType: 'application/json',
          encoding: 'table-records',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_CSV_IMPORTER_ID,
            providerVersion: builtinCsvImporterManifest.version,
          },
          sourceRefs: [tableRefId, binaryRefId],
          createdAt,
          metadata: {
            role: 'parsed-table',
            sourceArtifactId,
          },
        },
      ],
      createdAt,
      metadata: {
        importerRoute: 'signal',
        providerId: BUILTIN_CSV_IMPORTER_ID,
        rowCount: table.rowCount,
        columnCount: table.columns.length,
      },
    }, { now });

    const artifactPayloads: SignalImportArtifactPayload[] = asset.artifacts.map((artifact) => ({
      artifactId: artifact.artifactId,
      fileName: file.name,
      mimeType: artifact.mimeType,
      bytes: artifact.artifactId === tableArtifactId ? cloneArrayBuffer(tableBytes) : cloneArrayBuffer(fileBytes),
      artifact,
    }));

    return {
      asset,
      artifactPayloads,
      diagnostics: table.diagnostics.map((message) => ({
        severity: 'warning',
        code: 'csv.parse',
        message,
      })),
    };
  },
};
