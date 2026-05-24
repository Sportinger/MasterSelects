import type { ExtensionProviderManifest } from '../../extensions';
import { normalizeSignalAsset } from '../../signals';
import { cloneArrayBuffer, createSignalArtifactId, getFileExtension, guessMimeType } from '../fileIdentity';
import type { BuiltinSignalImportProvider } from '../types';
import { sha256ArrayBuffer } from '../hash';

export const BUILTIN_BINARY_FALLBACK_IMPORTER_ID = 'masterselects.import.binary-fallback';

export const builtinBinaryFallbackImporterManifest: ExtensionProviderManifest = {
  schemaVersion: 1,
  id: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
  version: '0.1.0',
  displayName: 'Binary Fallback Importer',
  role: 'importer',
  runtime: 'builtin',
  capabilities: ['file.read', 'artifact.write'],
  fileSignatures: [
    {},
  ],
  signals: {
    outputKinds: ['binary', 'metadata'],
  },
  metadata: {
    fallback: true,
    importPriority: -1000,
  },
};

export const builtinBinaryFallbackImporter: BuiltinSignalImportProvider = {
  manifest: builtinBinaryFallbackImporterManifest,
  requiredCapabilities: ['file.read', 'artifact.write'],
  importFile: async ({ file, fileBytes, assetId, now, absolutePath }) => {
    const createdAt = now();
    const mimeType = guessMimeType(file);
    const sourceHash = await sha256ArrayBuffer(fileBytes);
    const sourceArtifactId = createSignalArtifactId(assetId, 'source');
    const binaryRefId = `${assetId}:binary`;
    const metadataRefId = `${assetId}:metadata`;

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
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
      refs: [
        {
          id: binaryRefId,
          kind: 'binary',
          artifactId: sourceArtifactId,
          mimeType,
          metadata: {
            byteLength: file.size,
          },
        },
        {
          id: metadataRefId,
          kind: 'metadata',
          metadata: {
            sourceArtifactId,
            extension: getFileExtension(file.name),
            fallback: true,
          },
        },
      ],
      artifacts: [
        {
          artifactId: sourceArtifactId,
          hash: sourceHash,
          size: fileBytes.byteLength,
          mimeType,
          encoding: 'raw',
          storage: { kind: 'memory' },
          producer: {
            providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
            providerVersion: builtinBinaryFallbackImporterManifest.version,
          },
          sourceRefs: [binaryRefId],
          createdAt,
          metadata: {
            role: 'source',
            fallback: true,
            fileName: file.name,
            lastModified: file.lastModified,
          },
        },
      ],
      createdAt,
      metadata: {
        importerRoute: 'binary-fallback',
        providerId: BUILTIN_BINARY_FALLBACK_IMPORTER_ID,
      },
    }, { now });

    return {
      asset,
      artifactPayloads: [
        {
          artifactId: sourceArtifactId,
          fileName: file.name,
          mimeType,
          bytes: cloneArrayBuffer(fileBytes),
          artifact: asset.artifacts[0]!,
        },
      ],
      diagnostics: [
        {
          severity: 'info',
          code: 'binary.fallback',
          message: `Imported "${file.name}" as a binary SignalAsset.`,
        },
      ],
    };
  },
};
