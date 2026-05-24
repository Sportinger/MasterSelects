import { describe, expect, it } from 'vitest';
import {
  createBinarySignalAsset,
  isSignalAsset,
  isSignalArtifact,
  isSignalKind,
  normalizeSignalAsset,
  normalizeSignalMetadata,
  signalKindForNodeGraphSignalType,
  signalKindsForMediaType,
  signalKindsForTimelineSourceType,
} from '../../../src/signals';

const fixedNow = () => '2026-05-24T00:00:00.000Z';

describe('Signal IR contracts', () => {
  it('normalizes file assets with refs and artifacts into schema-versioned objects', () => {
    const asset = normalizeSignalAsset({
      id: 'asset-csv',
      name: 'Data',
      source: {
        kind: 'file',
        fileName: 'DATA.CSV',
        mimeType: 'text/csv',
        size: 12,
      },
      refs: [
        {
          id: 'asset-csv:table',
          kind: 'table',
          artifactId: 'artifact-csv',
          metadata: {
            columns: ['x', 'y'],
            ignored: undefined,
          },
        },
      ],
      artifacts: [
        {
          artifactId: 'artifact-csv',
          hash: 'sha256:abc',
          size: 12,
          mimeType: 'text/csv',
          encoding: 'csv',
          sourceRefs: ['asset-csv:table'],
        },
      ],
      metadata: {
        rowCount: 2,
        parser: 'builtin.csv',
        badNumber: Number.NaN,
      },
    }, { now: fixedNow });

    expect(asset.schemaVersion).toBe(1);
    expect(asset.source.extension).toBe('csv');
    expect(asset.refs[0]).toMatchObject({
      schemaVersion: 1,
      assetId: 'asset-csv',
      createdAt: fixedNow(),
    });
    expect(asset.artifacts[0]).toMatchObject({
      schemaVersion: 1,
      producer: { providerId: 'masterselects.core' },
      createdAt: fixedNow(),
    });
    expect(asset.metadata).toEqual({ rowCount: 2, parser: 'builtin.csv' });
    expect(isSignalAsset(asset)).toBe(true);
    expect(isSignalArtifact(asset.artifacts[0])).toBe(true);
  });

  it('creates binary SignalAssets for unknown-file fallback imports', () => {
    const asset = createBinarySignalAsset({
      id: 'asset-bin',
      name: 'unknown.bin',
      source: {
        kind: 'file',
        fileName: 'unknown.bin',
        mimeType: 'application/octet-stream',
        size: 3,
      },
      artifact: {
        artifactId: 'artifact-bin',
        hash: 'sha256:def',
        size: 3,
      },
    }, { now: fixedNow });

    expect(asset.refs).toHaveLength(1);
    expect(asset.refs[0]).toMatchObject({
      id: 'asset-bin:binary',
      kind: 'binary',
      artifactId: 'artifact-bin',
    });
    expect(isSignalAsset(asset)).toBe(true);
  });

  it('rejects non-json metadata values during normalization', () => {
    const metadata = normalizeSignalMetadata({
      ok: { nested: [1, 'two', true, null] },
      invalidFunction: () => 'nope',
      invalidArray: [1, undefined],
      invalidNumber: Infinity,
    });

    expect(metadata).toEqual({
      ok: { nested: [1, 'two', true, null] },
    });
  });

  it('maps existing media, timeline, and node graph types to SignalKind values', () => {
    expect(isSignalKind('point-cloud')).toBe(true);
    expect(signalKindForNodeGraphSignalType('render-target')).toBe('render-target');
    expect(signalKindForNodeGraphSignalType('table')).toBe('table');
    expect(signalKindsForTimelineSourceType('gaussian-splat')).toEqual(['point-cloud', 'geometry', 'metadata']);
    expect(signalKindsForTimelineSourceType('lottie')).toEqual(['vector', 'texture', 'metadata']);
    expect(signalKindsForMediaType('composition')).toEqual(['timeline', 'scene', 'metadata']);
  });
});
