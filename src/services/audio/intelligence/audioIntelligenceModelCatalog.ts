// Keep downloaded model bytes cached across analyzer refinements. Analysis
// artifacts carry their own analyzer version, so cached bytes can be reused
// as long as the model file itself is unchanged.
export const AUDIO_INTELLIGENCE_MODEL_CACHE_VERSION = 'silero-vad-v5.1.2-v1';

// Marks a catalog entry whose hash has not been pinned yet. Verification code
// must skip the integrity check (with a console warning) for this value.
export const UNPINNED_MODEL_SHA256 = 'TBD-PIN-BEFORE-SHIP';

export interface AudioIntelligenceModelCatalogEntry {
  id: 'silero-vad';
  displayName: string;
  version: string;
  fileName: string;
  url: string;
  sizeBytes: number;
  sha256: string;
}

export const AUDIO_INTELLIGENCE_MODEL_CATALOG: readonly AudioIntelligenceModelCatalogEntry[] = [
  {
    id: 'silero-vad',
    displayName: 'Silero VAD v5',
    version: 'v5.1.2',
    fileName: 'silero_vad.onnx',
    url: 'https://raw.githubusercontent.com/snakers4/silero-vad/v5.1.2/src/silero_vad/data/silero_vad.onnx',
    sizeBytes: 2_327_524,
    sha256: '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f',
  },
] as const;

export function requireAudioIntelligenceModel(
  id: AudioIntelligenceModelCatalogEntry['id'],
): AudioIntelligenceModelCatalogEntry {
  const entry = AUDIO_INTELLIGENCE_MODEL_CATALOG.find((model) => model.id === id);
  if (!entry) {
    throw new Error(`Unknown audio intelligence model: ${id}`);
  }
  return entry;
}

export function isModelHashPinned(entry: AudioIntelligenceModelCatalogEntry): boolean {
  return entry.sha256 !== UNPINNED_MODEL_SHA256;
}
