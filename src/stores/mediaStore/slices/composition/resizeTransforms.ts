import type { Composition, MediaState } from '../../types';
import type { Keyframe } from '../../../../types/keyframes';
import { calculateFitToFrameScale } from '../../../../utils/sourcePixelScale';
import { getCanvasSourceSize } from '../../../../services/text/textCanvasFrameRegistry';
import { useTimelineStore } from '../../../timeline';

/**
 * How layers follow a composition resize.
 * - 'pixels' (default): offsets keep the same composition-pixel distance and scale is untouched, so
 *   every layer keeps its native pixel size (the compositor derives it from the source and the new
 *   composition size). A layer that fitted the old canvas may overflow or shrink in the new one.
 * - 'relative': the layout keeps its proportions. Offsets stay the same fraction of the canvas and
 *   each layer's uniform scale follows its own fit-to-frame scale, so a fitted clip still fits, a
 *   picture-in-picture keeps its share of the frame, and x/y never stretch apart. Titles and
 *   solids use the size of their generated raster (what the compositor fits); a layer whose size is
 *   not known at all keeps its share of the frame area. Every factor depends on a reference that
 *   does not change with the resize, so A -> B -> A restores the exact scale.
 */
export type CompositionResizeLayout = 'pixels' | 'relative';

interface ResizableClip {
  mediaFileId?: string;
  compositionId?: string;
  source?: { mediaFileId?: string; textCanvas?: HTMLCanvasElement } | null;
  transform: { position: { x: number; y: number; z: number }; scale: { x: number; y: number } };
}

interface Size { width: number; height: number }

function positive(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Source size of a clip: its media file, nested composition, or generated raster (title, solid:
 * the full-frame size the compositor fits, read from the runtime canvas without keeping it).
 * Null when unknown (serialized clips of an inactive composition carry no raster).
 */
function sourceSizeOf(state: MediaState, clip: ResizableClip): Size | null {
  const mediaFileId = clip.source?.mediaFileId ?? clip.mediaFileId;
  const media = mediaFileId ? state.files.find(file => file.id === mediaFileId) : undefined;
  const nested = !media && clip.compositionId ? state.compositions.find(comp => comp.id === clip.compositionId) : undefined;
  const raster = !media && !nested && clip.source?.textCanvas ? getCanvasSourceSize(clip.source.textCanvas) : undefined;
  const width = positive(media?.width) ?? positive(nested?.width) ?? positive(raster?.width);
  const height = positive(media?.height) ?? positive(nested?.height) ?? positive(raster?.height);
  return width && height ? { width, height } : null;
}

/**
 * Factor that keeps a layer's share of the frame when the canvas goes from `from` to `to`.
 * With a known source it is fit(source in to) / fit(source in from). Without one it is the ratio
 * of the frame areas' square roots, so the layer keeps its share of the frame area. Both depend on
 * a reference that stays fixed, so factor(A, B) * factor(B, A) === 1 and chains are path independent
 * (using `from` as the reference would shrink a title on every step back and forth).
 */
export function relativeResizeScaleFactor(source: Size | null, from: Size, to: Size): number {
  const factor = source
    ? calculateFitToFrameScale(source.width, source.height, to.width, to.height)
      / calculateFitToFrameScale(source.width, source.height, from.width, from.height)
    : Math.sqrt((to.width * to.height) / (from.width * from.height));
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export function adjustClipTransformsOnResize(
  get: () => MediaState,
  compId: string,
  oldW: number,
  oldH: number,
  newW: number,
  newH: number,
  updates: Partial<Composition>,
  layout: CompositionResizeLayout = 'pixels',
): void {
  const relative = layout === 'relative';
  const positionX = relative ? 1 : oldW / newW;
  const positionY = relative ? 1 : oldH / newH;
  const state = get();
  const from = { width: oldW, height: oldH };
  const to = { width: newW, height: newH };
  const scaleFactor = (clip: ResizableClip) => (relative ? relativeResizeScaleFactor(sourceSizeOf(state, clip), from, to) : 1);

  const resizeTransform = <T extends ResizableClip['transform']>(transform: T, factor: number): T => ({
    ...transform,
    position: { x: transform.position.x * positionX, y: transform.position.y * positionY, z: transform.position.z },
    scale: factor === 1 ? transform.scale : { ...transform.scale, x: transform.scale.x * factor, y: transform.scale.y * factor },
  });
  const resizeKeyframe = (kf: Keyframe, factor: number): Keyframe => {
    if (kf.property === 'position.x') return { ...kf, value: kf.value * positionX };
    if (kf.property === 'position.y') return { ...kf, value: kf.value * positionY };
    if (factor !== 1 && (kf.property === 'scale.x' || kf.property === 'scale.y')) return { ...kf, value: kf.value * factor };
    return kf;
  };

  if (compId === state.activeCompositionId) {
    const { clips, clipKeyframes } = useTimelineStore.getState();
    const factors = new Map(clips.map(clip => [clip.id, scaleFactor(clip)]));
    const updatedClips = clips.map(clip => ({ ...clip, transform: resizeTransform(clip.transform, factors.get(clip.id) ?? 1) }));
    const updatedKeyframes = new Map<string, Keyframe[]>();
    clipKeyframes.forEach((keyframes: Keyframe[], clipId: string) => {
      const factor = factors.get(clipId) ?? 1;
      updatedKeyframes.set(clipId, keyframes.map(kf => resizeKeyframe(kf, factor)));
    });
    useTimelineStore.setState({ clips: updatedClips, clipKeyframes: updatedKeyframes });
    return;
  }

  const comp = state.compositions.find(c => c.id === compId);
  if (!comp?.timelineData) return;
  const updatedClips = comp.timelineData.clips.map(clip => {
    const factor = scaleFactor(clip);
    return {
      ...clip,
      transform: resizeTransform(clip.transform, factor),
      keyframes: clip.keyframes?.map(kf => resizeKeyframe(kf, factor)),
    };
  });
  updates.timelineData = { ...comp.timelineData, clips: updatedClips };
}
