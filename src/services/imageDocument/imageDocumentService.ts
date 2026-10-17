import { Logger } from '../logger';
import { useDockStore, FACTORY_IMAGE_EDIT_LAYOUT_ID } from '../../stores/dockStore';
import { useMediaStore } from '../../stores/mediaStore';
import type { Composition, MediaFile } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import { findReusableTopLayerTrack, IMAGE_DOCUMENT_DURATION } from './imageLayers';

const log = Logger.create('ImageDocument');

export type ImageDocumentBackground = 'white' | 'black' | 'transparent';

export interface NewImageDocumentOptions {
  name?: string;
  width: number;
  height: number;
  background: ImageDocumentBackground;
}

const BACKGROUND_COLORS: Record<Exclude<ImageDocumentBackground, 'transparent'>, string> = {
  white: '#ffffff',
  black: '#000000',
};

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '').trim() || fileName;
}

function clampDimension(value: number | undefined, fallback: number): number {
  const rounded = Math.round(value ?? fallback);
  return Number.isFinite(rounded) && rounded > 0 ? Math.min(rounded, 16384) : fallback;
}

export function enterImageWorkspace(): void {
  const dock = useDockStore.getState();
  if (dock.activeSavedLayoutId !== FACTORY_IMAGE_EDIT_LAYOUT_ID) {
    dock.loadSavedLayout(FACTORY_IMAGE_EDIT_LAYOUT_ID);
  }
}

export function getActiveImageDocument(): Composition | null {
  const composition = useMediaStore.getState().getActiveComposition();
  return composition?.still ? composition : null;
}

async function openNewStillComposition(name: string, width: number, height: number): Promise<Composition> {
  const media = useMediaStore.getState();
  const composition = media.createComposition(name, {
    width,
    height,
    duration: IMAGE_DOCUMENT_DURATION,
    frameRate: 30,
    still: true,
  });
  await media.openCompositionTab(composition.id, { skipAnimation: true });
  useTimelineStore.getState().setPlayheadPosition(0);
  return composition;
}

/** Mirror the live timeline into the new composition right away, like Create Comp does. */
function mirrorTimeline(compositionId: string): void {
  useMediaStore.getState().updateComposition(compositionId, {
    timelineData: useTimelineStore.getState().getSerializableState(),
  });
}

/**
 * Pick the track for a new layer and place it above the selected layer,
 * matching Photoshop's "new layer goes above the current one".
 */
function prepareLayerTrack(): string {
  const timeline = useTimelineStore.getState();
  const reusable = findReusableTopLayerTrack(timeline.tracks, timeline.clips);
  const trackId = reusable?.id ?? timeline.addTrack('video');
  const selectedClip = timeline.clips.find((clip) => timeline.selectedClipIds.has(clip.id));
  if (selectedClip && selectedClip.trackId !== trackId) {
    useTimelineStore.getState().reorderTrack(trackId, selectedClip.trackId, false);
  }
  return trackId;
}

export async function createImageDocument(options: NewImageDocumentOptions): Promise<Composition> {
  const width = clampDimension(options.width, 1920);
  const height = clampDimension(options.height, 1080);
  const composition = await openNewStillComposition(options.name?.trim() || 'Image', width, height);
  if (options.background !== 'transparent') {
    const timeline = useTimelineStore.getState();
    const trackId = findReusableTopLayerTrack(timeline.tracks, timeline.clips)?.id ?? timeline.addTrack('video');
    const clipId = timeline.addSolidClip(trackId, 0, BACKGROUND_COLORS[options.background], IMAGE_DOCUMENT_DURATION);
    if (clipId) useTimelineStore.getState().updateClip(clipId, { name: 'Background' });
  }
  mirrorTimeline(composition.id);
  enterImageWorkspace();
  log.info('Created image document', { compositionId: composition.id, width, height, background: options.background });
  return composition;
}

/** Open a photo as a new image document sized to the photo. */
export async function openMediaFileAsImageDocument(mediaFile: MediaFile): Promise<Composition | null> {
  if (!mediaFile.file || (mediaFile.type !== 'image' && mediaFile.type !== 'video')) {
    log.warn('Only image and video media can open as an image document', { mediaFileId: mediaFile.id, type: mediaFile.type });
    return null;
  }
  const composition = await openNewStillComposition(
    baseName(mediaFile.name),
    clampDimension(mediaFile.width, 1920),
    clampDimension(mediaFile.height, 1080),
  );
  await addImageLayerFromMediaFile(mediaFile);
  mirrorTimeline(composition.id);
  enterImageWorkspace();
  return composition;
}

/** Add a media file as a new layer of the active composition, spanning the image document. */
export async function addImageLayerFromMediaFile(mediaFile: MediaFile): Promise<string | null> {
  const composition = useMediaStore.getState().getActiveComposition();
  if (!composition || !mediaFile.file) {
    log.warn('Cannot add an image layer without an active composition and a loaded file', { mediaFileId: mediaFile.id });
    return null;
  }
  const trackId = prepareLayerTrack();
  const { startTime, duration } = layerSpan();
  const clipId = await useTimelineStore.getState().addClip(trackId, mediaFile.file, startTime, duration, mediaFile.id, mediaFile.type);
  if (!clipId) {
    log.warn('Adding the image layer failed', { mediaFileId: mediaFile.id });
    return null;
  }
  useTimelineStore.getState().selectClip(clipId);
  return clipId;
}

/** Import picked or dropped files and add each image or video as a layer. */
export async function addImageLayersFromFiles(files: readonly File[]): Promise<number> {
  const imported = await useMediaStore.getState().importFiles([...files]);
  let added = 0;
  for (const item of imported) {
    if (item.type !== 'image' && item.type !== 'video') {
      log.warn('Skipped a non-visual file for an image layer', { name: item.name, type: item.type });
      continue;
    }
    if (await addImageLayerFromMediaFile(item as MediaFile)) added += 1;
  }
  return added;
}

/** Render the active composition at the playhead and open that frame as a new image document. */
export async function createImageDocumentFromCurrentFrame(): Promise<Composition | null> {
  const media = useMediaStore.getState();
  const source = media.getActiveComposition();
  if (!source) return null;
  const time = useTimelineStore.getState().playheadPosition;
  const { captureCompositionFrameBlob } = await import('../../components/export/captureCompositionFrame');
  const blob = await captureCompositionFrameBlob(time, 'png');
  if (!blob) throw new Error('Could not render the current frame.');
  const fileName = `${baseName(source.name)} frame ${time.toFixed(2)}s.png`;
  const file = new File([blob], fileName, { type: 'image/png' });
  const imported = await media.importFile(file, null, { forceCopyToProject: true, projectFileName: fileName });
  if (imported.type !== 'image') throw new Error('The rendered frame could not be imported.');
  return openMediaFileAsImageDocument(imported as MediaFile);
}

/** Download the image document as a PNG at full composition resolution. */
export async function exportActiveImageAsPng(): Promise<boolean> {
  const composition = useMediaStore.getState().getActiveComposition();
  if (!composition) return false;
  const time = composition.still ? 0 : useTimelineStore.getState().playheadPosition;
  const [{ captureCompositionFrameBlob }, { downloadBlob }] = await Promise.all([
    import('../../components/export/captureCompositionFrame'),
    import('../../engine/export/FrameExporter'),
  ]);
  const blob = await captureCompositionFrameBlob(time, 'png');
  if (!blob) return false;
  downloadBlob(blob, `${baseName(composition.name).replace(/[<>:"/\\|?*]/g, '_')}.png`);
  return true;
}

function layerSpan(): { startTime: number; duration: number | undefined } {
  const composition = useMediaStore.getState().getActiveComposition();
  if (composition?.still) return { startTime: 0, duration: composition.timelineData?.duration ?? composition.duration };
  return { startTime: useTimelineStore.getState().playheadPosition, duration: undefined };
}

export async function addTextLayer(): Promise<string | null> {
  if (!useMediaStore.getState().getActiveComposition()) return null;
  const trackId = prepareLayerTrack();
  const { startTime, duration } = layerSpan();
  const clipId = await useTimelineStore.getState().addTextClip(trackId, startTime, duration);
  if (clipId) useTimelineStore.getState().selectClip(clipId);
  return clipId;
}

export function addSolidLayer(color = '#808080'): string | null {
  if (!useMediaStore.getState().getActiveComposition()) return null;
  const trackId = prepareLayerTrack();
  const { startTime, duration } = layerSpan();
  const clipId = useTimelineStore.getState().addSolidClip(trackId, startTime, color, duration);
  if (clipId) useTimelineStore.getState().selectClip(clipId);
  return clipId;
}

/** Delete a layer; in an image document its now-empty track goes with it. */
export function deleteImageLayer(clipId: string): void {
  const timeline = useTimelineStore.getState();
  const clip = timeline.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return;
  const track = timeline.tracks.find((candidate) => candidate.id === clip.trackId);
  if (track?.locked) {
    log.warn('Locked layers cannot be deleted', { clipId });
    return;
  }
  const trackHasOtherClips = timeline.clips.some((candidate) => candidate.trackId === clip.trackId && candidate.id !== clipId);
  const remainingVideoTracks = timeline.tracks.filter((candidate) => candidate.type === 'video').length;
  if (getActiveImageDocument() && !trackHasOtherClips && remainingVideoTracks > 1) {
    timeline.removeTrack(clip.trackId);
  } else {
    timeline.removeClip(clipId);
  }
}

/** Select a layer and show its effects or masks in the Properties panel. */
export function openLayerProperties(clipId: string, tab: 'effects' | 'masks'): void {
  useTimelineStore.getState().selectClip(clipId);
  useDockStore.getState().activatePanelType('clip-properties');
  // The Properties panel may mount with this activation; let it subscribe first.
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } })), 50);
}
