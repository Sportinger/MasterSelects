import { describe, expect, it } from 'vitest';
import { SIGNAL_SCHEMA_VERSION } from '../../../src/signals';
import type { SignalAssetItem } from '../../../src/stores/mediaStore';
import {
  createSignalTimelineRenderPlan,
  SIGNAL_TEXT_RENDERER_ADAPTER_ID,
} from '../../../src/runtime/renderers/signalTextRendererAdapter';

function makeSignalAssetItem(overrides?: Partial<SignalAssetItem>): SignalAssetItem {
  const now = '2026-05-24T00:00:00.000Z';
  return {
    id: 'signal-1',
    name: 'scores.csv',
    type: 'signal',
    parentId: null,
    createdAt: Date.parse(now),
    asset: {
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      id: 'signal-1',
      name: 'scores.csv',
      source: {
        kind: 'file',
        fileName: 'scores.csv',
        extension: 'csv',
        mimeType: 'text/csv',
        size: 24,
      },
      refs: [
        {
          schemaVersion: SIGNAL_SCHEMA_VERSION,
          id: 'scores:table',
          kind: 'table',
          artifactId: 'artifact-table',
          createdAt: now,
          metadata: {
            format: 'csv',
            rowCount: 2,
            columnCount: 2,
            columns: ['name', 'score'],
            columnTypes: [
              { name: 'name', type: 'string' },
              { name: 'score', type: 'number' },
            ],
            previewRows: [
              ['Ada', '42'],
              ['Grace', '99'],
            ],
          },
        },
        {
          schemaVersion: SIGNAL_SCHEMA_VERSION,
          id: 'scores:metadata',
          kind: 'metadata',
          createdAt: now,
        },
      ],
      artifacts: [
        {
          schemaVersion: SIGNAL_SCHEMA_VERSION,
          artifactId: 'artifact-table',
          hash: 'sha256:abc',
          size: 24,
          mimeType: 'text/csv',
          encoding: 'csv',
          storage: { kind: 'memory' },
          producer: { providerId: 'test' },
          sourceRefs: ['scores:table'],
          createdAt: now,
        },
      ],
      createdAt: now,
    },
    artifacts: [],
    signalKinds: ['table', 'metadata'],
    fileSize: 24,
    ...overrides,
  };
}

describe('signalTextRendererAdapter', () => {
  it('creates a deterministic text render plan for table signals', () => {
    const plan = createSignalTimelineRenderPlan(makeSignalAssetItem());

    expect(plan).toMatchObject({
      adapterId: SIGNAL_TEXT_RENDERER_ADAPTER_ID,
      clipName: 'scores.csv',
      duration: 5,
      signalAssetId: 'signal-1',
      signalRefId: 'scores:table',
    });
    expect(plan.textProperties.text).toContain('scores.csv');
    expect(plan.textProperties.text).toContain('2 rows x 2 columns');
    expect(plan.textProperties.text).toContain('name | score');
    expect(plan.textProperties.boxEnabled).toBe(true);
    expect(plan.textProperties.textAlign).toBe('left');
  });

  it('summarizes binary signals without requiring artifact bytes', () => {
    const binary = makeSignalAssetItem({
      name: 'part.step',
      signalKinds: ['binary', 'metadata'],
    });
    binary.asset.name = 'part.step';
    binary.asset.source = {
      kind: 'file',
      fileName: 'part.step',
      extension: 'step',
      mimeType: 'application/step',
      size: 4,
    };
    binary.asset.refs = [{
      schemaVersion: SIGNAL_SCHEMA_VERSION,
      id: 'part:binary',
      kind: 'binary',
      artifactId: 'artifact-binary',
      createdAt: '2026-05-24T00:00:00.000Z',
      metadata: {
        format: 'binary',
        mimeType: 'application/step',
        byteLength: 4,
        headerHex: '01 02 03 04',
      },
    }];

    const plan = createSignalTimelineRenderPlan(binary);

    expect(plan.signalRefId).toBe('part:binary');
    expect(plan.textProperties.text).toContain('Binary Signal');
    expect(plan.textProperties.text).toContain('application/step');
    expect(plan.textProperties.text).toContain('4 B');
  });
});
