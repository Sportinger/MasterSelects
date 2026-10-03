import { describe, expect, it } from 'vitest';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import { preservedSourceArtifacts } from '../../src/stores/mediaStore/slices/fileImport/singleFileImportActions';

describe('repair re-import keeps source artifacts', () => {
  it('keeps transcript, analysis and scenes of the same source and skips unset defaults', () => {
    const transcript = [{ id: 'w' }] as never;
    const existing = { id: 'm', transcriptStatus: 'ready', transcript, analysisStatus: 'none', sceneDescriptions: [] } as unknown as MediaFile;
    const kept = preservedSourceArtifacts(existing);
    expect(kept.transcriptStatus).toBe('ready');
    expect(kept.transcript).toBe(transcript);
    expect(kept).not.toHaveProperty('analysisStatus');
    // The fresh import's defaults lose against kept artifacts in the repair merge order.
    expect({ ...existing, ...{ transcriptStatus: 'none', transcript: undefined }, ...kept }.transcriptStatus).toBe('ready');
  });
});
