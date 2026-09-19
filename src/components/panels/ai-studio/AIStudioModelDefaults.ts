import type { CatalogEntry } from '../../../services/flashboard/types';
import type { FlashBoardComposerState } from '../../../stores/flashboardStore/types';

export function buildAIStudioModelPatch(
  entry: CatalogEntry,
  composer: FlashBoardComposerState,
): Partial<FlashBoardComposerState> {
  const patch: Partial<FlashBoardComposerState> = {};
  const outputType = entry.outputType ?? composer.outputType ?? 'image';
  const version = entry.versions.includes(composer.version ?? '')
    ? composer.version
    : entry.versions[0] ?? composer.version;
  const aspectRatio = entry.aspectRatios.includes(composer.aspectRatio ?? '')
    ? composer.aspectRatio
    : entry.aspectRatios[0] ?? composer.aspectRatio;
  const duration = entry.durations.includes(composer.duration ?? -1)
    ? composer.duration
    : entry.durations[0] ?? composer.duration;
  const imageSize = entry.imageSizes?.includes(composer.imageSize ?? '')
    ? composer.imageSize
    : entry.imageSizes?.[0] ?? composer.imageSize;
  const mode = entry.modes.includes(composer.mode ?? '')
    ? composer.mode
    : entry.modes[0] ?? composer.mode;
  const generateAudio = entry.supportsGenerateAudio ? Boolean(composer.generateAudio) : false;
  const multiShots = entry.supportsMultiShot ? Boolean(composer.multiShots) : false;

  if (composer.service !== entry.service) patch.service = entry.service;
  if (composer.providerId !== entry.providerId) patch.providerId = entry.providerId;
  if (composer.outputType !== outputType) patch.outputType = outputType;
  if (composer.version !== version) patch.version = version;
  if (composer.aspectRatio !== aspectRatio) patch.aspectRatio = aspectRatio;
  if (composer.duration !== duration) patch.duration = duration;
  if (composer.imageSize !== imageSize) patch.imageSize = imageSize;
  if (composer.mode !== mode) patch.mode = mode;
  if (composer.generateAudio !== generateAudio) patch.generateAudio = generateAudio;
  if (composer.multiShots !== multiShots) patch.multiShots = multiShots;

  return patch;
}
