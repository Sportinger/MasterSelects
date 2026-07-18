export type SourceMediaFile = {
  duration?: number;
  transcript?: import('../../../types').TranscriptWord[];
  transcriptStatus?: string;
  modelSequence?: import('../../../types').ModelSequenceData;
  gaussianSplatSequence?: import('../../../types').GaussianSplatSequenceData;
  vectorAnimation?: import('../../../types').VectorAnimationMetadata;
  url?: string;
  name?: string;
  projectPath?: string;
  absolutePath?: string;
  filePath?: string;
};

export async function loadSourceMediaFile(mediaFileId: string | undefined): Promise<SourceMediaFile | undefined> {
  if (!mediaFileId) return undefined;
  try {
    const { useMediaStore } = await import('../../mediaStore');
    return useMediaStore.getState().files.find((file: { id: string }) => file.id === mediaFileId);
  } catch {
    return undefined;
  }
}

export function hasVisualMediaType(mediaType: string): boolean {
  return mediaType === 'video' ||
    mediaType === 'image' ||
    mediaType === 'lottie' ||
    mediaType === 'rive' ||
    mediaType === 'model' ||
    mediaType === 'gaussian-avatar' ||
    mediaType === 'gaussian-splat';
}
