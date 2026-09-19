import { linkedMediaSourceRuntime } from '../mediaRuntime/linkedMediaSourceRuntime';

export interface LayerBuilderVideoMediaMetadata {
  id?: string;
  width?: number;
  height?: number;
  linkedSources?: Array<{
    id: string;
    role: 'proxy' | 'alternate';
    origin?: 'premiere';
  }>;
  sourceSelection?: { mode: 'auto' | 'original' } | { mode: 'linked'; sourceId: string };
}

export function getPremiereProxyCompositionDimensions(
  mediaFile: LayerBuilderVideoMediaMetadata | undefined,
  composition: { width?: number; height?: number } | undefined,
): { width?: number; height?: number } {
  const activeSource = mediaFile?.id
    ? linkedMediaSourceRuntime.getActive(mediaFile.id)
    : undefined;
  const selectedSourceId = activeSource?.kind === 'linked'
    ? activeSource.sourceId
    : mediaFile?.sourceSelection?.mode === 'linked'
      ? mediaFile.sourceSelection.sourceId
      : undefined;
  const usesPremiereProxy = mediaFile?.linkedSources?.some((source) => (
    source.id === selectedSourceId
    && source.role === 'proxy'
    && source.origin === 'premiere'
  )) ?? false;
  return usesPremiereProxy ? composition ?? {} : {};
}
