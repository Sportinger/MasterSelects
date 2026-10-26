import { describe, expect, it } from 'vitest';
import { decodeProjectDomains, encodeProjectDomains } from '../../src/services/project/repository/domains/projectDomains';
import { sanitizeStoreData } from '../../src/stores/exportDefinitions';
import type { ProjectFile } from '../../src/services/project/types/project.types';

// Projects saved before batch export carry an exportState without `batch`; opening or
// resuming them crashed with "Cannot read properties of undefined (reading 'selectedJobId')".
function legacyProject(): ProjectFile {
  return {
    version: 1, name: 'Before batch export', createdAt: '2026-01-10', updatedAt: '2026-01-10',
    settings: { width: 1920, height: 1080, frameRate: 30, sampleRate: 48000 },
    media: [], folders: [], compositions: [], activeCompositionId: null, openCompositionIds: [], expandedFolderIds: [],
    uiState: { exportState: { settings: { encoder: 'webcodecs' }, presets: [], selectedPresetId: null } },
  } as unknown as ProjectFile;
}

describe('legacy export state without batch', () => {
  it('encodes and decodes without a batch, and activation data falls back to an empty batch', () => {
    const encoded = encodeProjectDomains(legacyProject());
    const decoded = decodeProjectDomains(encoded.entities, encoded.workspace, encoded.journals);
    const exportState = decoded.uiState?.exportState;
    expect(exportState).toBeDefined();
    expect(exportState?.batch).toEqual({ selectedJobId: null });
    // The editor activation sanitizes this before it reaches the export store.
    expect(sanitizeStoreData(exportState).batch).toEqual({ enabled: false, useSharedSettings: false, selectedJobId: null, jobs: [] });
  });
});
