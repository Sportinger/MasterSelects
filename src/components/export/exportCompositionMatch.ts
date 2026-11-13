// Whether an export follows the active composition's size and frame rate, and what a viewer
// would notice when it does not. Pure, so the panel, tests and tools decide the same way.

import type { ExportSettings } from '../../stores/exportStore';

/** Size and frame rate of a composition, or of an export. */
export interface CompositionFormat {
  width: number;
  height: number;
  frameRate: number;
}

export type CompositionMatchSettings = Pick<ExportSettings,
  | 'width' | 'height' | 'customWidth' | 'customHeight' | 'useCustomResolution'
  | 'fps' | 'customFps' | 'useCustomFps'
  | 'matchCompositionResolution' | 'matchCompositionFrameRate'>;

export interface CompositionMatch {
  resolution: boolean;
  frameRate: boolean;
}

export interface CompositionMismatchNotes {
  resolution: string | null;
  frameRate: string | null;
}

/** Aspect ratios closer than this count as the same picture shape. */
const ASPECT_TOLERANCE = 0.01;

/** The format the settings export on their own, before anything follows a composition. */
export function resolveExportFormat(settings: CompositionMatchSettings): CompositionFormat {
  return {
    width: settings.useCustomResolution ? settings.customWidth : settings.width,
    height: settings.useCustomResolution ? settings.customHeight : settings.height,
    frameRate: settings.useCustomFps ? settings.customFps : settings.fps,
  };
}

/**
 * Whether the export follows the active composition.
 *
 * The stored choice wins. Settings saved before the choice was stored are read like this:
 * a format equal to the active composition follows it, and so does a custom size whose size
 * and frame rate are exactly those of another composition, because only "Same as composition"
 * writes such a pair. Any other format was picked on purpose and stays.
 */
export function resolveCompositionMatch(
  settings: CompositionMatchSettings,
  active: CompositionFormat | undefined,
  compositions: readonly CompositionFormat[],
): CompositionMatch {
  const format = resolveExportFormat(settings);
  const sameSize = (composition: CompositionFormat) => (
    composition.width === format.width && composition.height === format.height
  );
  const followedAnotherComposition = settings.useCustomResolution
    && compositions.some(composition => sameSize(composition) && composition.frameRate === format.frameRate);

  return {
    resolution: settings.matchCompositionResolution
      ?? (followedAnotherComposition || (!!active && sameSize(active))),
    frameRate: settings.matchCompositionFrameRate
      ?? (followedAnotherComposition || (!!active && active.frameRate === format.frameRate)),
  };
}

/** The settings change that brings a followed format in line with the composition, or null. */
export function buildCompositionMatchPatch(
  settings: CompositionMatchSettings,
  match: CompositionMatch,
  active: CompositionFormat,
): Partial<ExportSettings> | null {
  const format = resolveExportFormat(settings);
  const patch: Partial<ExportSettings> = {};

  if (match.resolution && (format.width !== active.width || format.height !== active.height)) {
    patch.customWidth = active.width;
    patch.customHeight = active.height;
    patch.useCustomResolution = true;
    patch.matchCompositionResolution = true;
  }
  if (match.frameRate && format.frameRate !== active.frameRate) {
    patch.customFps = active.frameRate;
    patch.useCustomFps = true;
    patch.matchCompositionFrameRate = true;
  }

  return Object.keys(patch).length > 0 ? patch : null;
}

function formatFrameRate(frameRate: number): string {
  return String(Number(frameRate.toFixed(3)));
}

/**
 * Plain-language notes for an export that does not follow the composition and would look
 * different from the preview: another picture shape adds black bars, another frame rate
 * repeats or drops frames. A plain resize with the same shape needs no note.
 */
export function describeCompositionMismatch(
  settings: CompositionMatchSettings,
  match: CompositionMatch,
  active: CompositionFormat,
): CompositionMismatchNotes {
  const format = resolveExportFormat(settings);
  const exportAspect = format.width / Math.max(1, format.height);
  const compositionAspect = active.width / Math.max(1, active.height);
  const shapeDiffers = Math.abs(exportAspect - compositionAspect) / compositionAspect > ASPECT_TOLERANCE;

  return {
    resolution: !match.resolution && shapeDiffers
      ? `The composition is ${active.width}×${active.height}. A ${format.width}×${format.height} export adds black bars.`
      : null,
    frameRate: !match.frameRate && format.frameRate !== active.frameRate
      ? `The composition runs at ${formatFrameRate(active.frameRate)} fps. Exporting at ${formatFrameRate(format.frameRate)} fps repeats or drops frames.`
      : null,
  };
}
