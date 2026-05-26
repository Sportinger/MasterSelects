import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import { requireMediaFileImportResult } from '../../stores/mediaStore/helpers/importResult';
import { useFlashBoardStore } from '../../stores/flashboardStore';
import { captureCurrentPreviewFrameFile } from '../previewFrameCapture';
import type {
  FlashBoardGenerationMetadata,
  FlashBoardMediaType,
  FlashBoardResult,
  FlashBoardNode,
} from '../../stores/flashboardStore/types';
import type { MediaFile } from '../../stores/mediaStore';
import { setExternalDragPayload, clearExternalDragPayload } from '../../components/timeline/utils/externalDragSession';

const log = Logger.create('FlashBoardMedia');

/**
 * Sanitize a prompt string into a safe filename fragment.
 * Strips non-alphanumeric chars (except spaces/hyphens), truncates to maxLen.
 */
function sanitizeForFilename(prompt: string, maxLen = 30): string {
  return prompt
    .replace(/[^a-zA-Z0-9 -]/g, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, maxLen)
    .replace(/_$/, '')
    .toLowerCase() || 'untitled';
}

/**
 * Find a FlashBoardNode by ID across all boards.
 */
function findNodeById(nodeId: string): FlashBoardNode | undefined {
  const { boards } = useFlashBoardStore.getState();
  for (const board of boards) {
    const node = board.nodes.find(n => n.id === nodeId);
    if (node) return node;
  }
  return undefined;
}

/**
 * FlashBoardMediaBridge handles importing AI-generated media into the Media Pool
 * and provides timeline integration (drag protocol, direct add-to-timeline).
 *
 * Lifecycle:
 *   1. Job completes with a videoUrl
 *   2. Bridge downloads the video as a File
 *   3. Bridge imports the File into the Media Pool under "AI Gen / Video" (or "Images")
 *   4. Bridge updates the FlashBoard node with the result (mediaFileId, dimensions, duration)
 *   5. Bridge stores generation metadata keyed by mediaFileId for project persistence
 *
 * The imported media is then draggable to the timeline using the standard
 * `application/x-media-file-id` drag protocol.
 */
class FlashBoardMediaBridge {
  private generationMetadata: Map<string, FlashBoardGenerationMetadata> = new Map();

  // ---------------------------------------------------------------------------
  // Folder management — "AI Gen" with "Video" and "Images" subfolders
  // ---------------------------------------------------------------------------

  /**
   * Get or create the top-level "AI Gen" folder in the Media Pool.
   */
  getOrCreateAIGenFolder(): string {
    const { folders, createFolder } = useMediaStore.getState();
    let aiGen = folders.find(f => f.name === 'AI Gen' && !f.parentId);
    if (!aiGen) {
      aiGen = createFolder('AI Gen');
    }
    return aiGen.id;
  }

  /**
   * Get or create the "AI Gen / Video" subfolder.
   */
  getOrCreateVideoSubfolder(): string {
    const parentId = this.getOrCreateAIGenFolder();
    const { folders, createFolder } = useMediaStore.getState();
    let videoFolder = folders.find(f => f.name === 'Video' && f.parentId === parentId);
    if (!videoFolder) {
      videoFolder = createFolder('Video', parentId);
    }
    return videoFolder.id;
  }

  /**
   * Get or create the "AI Gen / Images" subfolder.
   */
  getOrCreateImageSubfolder(): string {
    const parentId = this.getOrCreateAIGenFolder();
    const { folders, createFolder } = useMediaStore.getState();
    let imageFolder = folders.find(f => f.name === 'Images' && f.parentId === parentId);
    if (!imageFolder) {
      imageFolder = createFolder('Images', parentId);
    }
    return imageFolder.id;
  }

  /**
   * Get or create the "AI Gen / Audio" subfolder.
   */
  getOrCreateAudioSubfolder(): string {
    const parentId = this.getOrCreateAIGenFolder();
    const { folders, createFolder } = useMediaStore.getState();
    let audioFolder = folders.find(f => f.name === 'Audio' && f.parentId === parentId);
    if (!audioFolder) {
      audioFolder = createFolder('Audio', parentId);
    }
    return audioFolder.id;
  }

  private getOrCreateMediaSubfolder(mediaType: FlashBoardMediaType): string {
    if (mediaType === 'audio') {
      return this.getOrCreateAudioSubfolder();
    }
    if (mediaType === 'image') {
      return this.getOrCreateImageSubfolder();
    }
    return this.getOrCreateVideoSubfolder();
  }

  // ---------------------------------------------------------------------------
  // Download
  // ---------------------------------------------------------------------------

  /**
   * Download a remote file and return it as a File object.
   */
  async downloadAsFile(url: string, filename: string): Promise<File> {
    log.debug(`Downloading: ${filename} from ${url}`);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Download failed: HTTP ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    const type = blob.type || 'video/mp4';
    return new File([blob], filename, { type });
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  /**
   * Import a completed AI generation result into the Media Pool.
   *
   * Downloads the media from the remote URL, imports it into the correct
   * subfolder, stores generation metadata, and updates the FlashBoard node.
   *
   * @returns The FlashBoardResult with mediaFileId and dimensions.
   */
  private buildMetadata(
    mediaFileId: string,
    node: FlashBoardNode | undefined,
    mediaType: FlashBoardMediaType,
  ): FlashBoardGenerationMetadata | null {
    if (!node?.request) {
      return null;
    }

    return {
      mediaFileId,
      service: node.request.service,
      providerId: node.request.providerId,
      version: node.request.version,
      outputType: node.request.outputType,
      mediaType,
      prompt: node.request.prompt,
      negativePrompt: node.request.negativePrompt,
      duration: node.request.duration,
      aspectRatio: node.request.aspectRatio,
      imageSize: node.request.imageSize,
      generateAudio: node.request.generateAudio,
      multiShots: node.request.multiShots,
      multiPrompt: node.request.multiPrompt,
      voiceId: node.request.voiceId,
      voiceName: node.request.voiceName,
      languageOverride: node.request.languageOverride,
      languageCode: node.request.languageCode,
      outputFormat: node.request.outputFormat,
      voiceSettings: node.request.voiceSettings,
      sunoCustomMode: node.request.sunoCustomMode,
      sunoInstrumental: node.request.sunoInstrumental,
      sunoStyle: node.request.sunoStyle,
      sunoTitle: node.request.sunoTitle,
      sunoNegativeTags: node.request.sunoNegativeTags,
      sunoVocalGender: node.request.sunoVocalGender,
      sunoStyleWeight: node.request.sunoStyleWeight,
      sunoWeirdnessConstraint: node.request.sunoWeirdnessConstraint,
      sunoAudioWeight: node.request.sunoAudioWeight,
      startMediaFileId: node.request.startMediaFileId,
      endMediaFileId: node.request.endMediaFileId,
      referenceMediaFileIds: node.request.referenceMediaFileIds ?? [],
      createdAt: new Date().toISOString(),
    };
  }

  async importGeneratedFile(
    nodeId: string,
    file: File,
    mediaType: FlashBoardMediaType,
  ): Promise<FlashBoardResult> {
    const node = findNodeById(nodeId);
    const folderId = this.getOrCreateMediaSubfolder(mediaType);

    const mediaFile = requireMediaFileImportResult(
      await useMediaStore.getState().importFile(file, folderId, {
        // Generated files must remain project-local even when global imports use references.
        forceCopyToProject: true,
      }),
      'FlashBoard media import',
    );

    if (!mediaFile) {
      throw new Error('Failed to import media file into Media Pool');
    }

    const result: FlashBoardResult = {
      mediaFileId: mediaFile.id,
      mediaType,
      duration: mediaFile.duration,
      width: mediaFile.width,
      height: mediaFile.height,
    };

    const metadata = this.buildMetadata(mediaFile.id, node, mediaType);
    if (metadata) {
      this.generationMetadata.set(mediaFile.id, metadata);
    }

    useFlashBoardStore.getState().completeNode(nodeId, result);

    log.info(`Imported AI ${mediaType}: ${file.name} -> ${mediaFile.id}`);
    return result;
  }

  async importGeneratedMedia(
    nodeId: string,
    videoUrl: string,
    mediaType: FlashBoardMediaType = 'video'
  ): Promise<FlashBoardResult> {
    // Look up the node to get prompt/request info
    const node = findNodeById(nodeId);
    const prompt = node?.request?.prompt ?? '';

    // Build a human-readable filename
    const timestamp = Date.now();
    const ext = mediaType === 'video' ? 'mp4' : mediaType === 'image' ? 'png' : 'mp3';
    const shortPrompt = sanitizeForFilename(prompt, 30);
    const filename = `ai_${shortPrompt}_${timestamp}.${ext}`;

    // Download the file
    let file: File;
    try {
      file = await this.downloadAsFile(videoUrl, filename);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown download error';
      log.error(`Failed to download media for node ${nodeId}: ${message}`);
      throw err;
    }

    return this.importGeneratedFile(nodeId, file, mediaType);
  }

  async importCurrentFrame(): Promise<MediaFile> {
    const file = await captureCurrentPreviewFrameFile('flashboard_frame');
    if (!file) {
      throw new Error('Current preview frame is not available.');
    }

    const folderId = this.getOrCreateImageSubfolder();
    const mediaFile = requireMediaFileImportResult(
      await useMediaStore.getState().importFile(file, folderId, {
        forceCopyToProject: true,
      }),
      'FlashBoard frame import',
    );

    log.info(`Imported current preview frame: ${mediaFile.name} -> ${mediaFile.id}`);
    return mediaFile;
  }

  // ---------------------------------------------------------------------------
  // Timeline drag protocol (matches MediaPanel exactly)
  // ---------------------------------------------------------------------------

  /**
   * Start a drag-to-timeline operation from a FlashBoard node.
   *
   * Uses the same `application/x-media-file-id` protocol and
   * ExternalDragPayload session that the MediaPanel uses, so the
   * timeline drop handler works without any changes.
   */
  startDragToTimeline(event: DragEvent, mediaFileId: string): void {
    if (!event.dataTransfer) return;

    const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
    if (!mediaFile || !mediaFile.file || mediaFile.isImporting) {
      log.warn('Cannot start drag — media file not ready:', mediaFileId);
      return;
    }

    // Set the ExternalDragPayload so the timeline drop handler can resolve it
    const isAudioOnly =
      mediaFile.file.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(mediaFile.file.name);

    setExternalDragPayload({
      kind: 'media-file',
      id: mediaFile.id,
      duration: mediaFile.duration,
      hasAudio: mediaFile.type === 'image' ? false : isAudioOnly ? true : mediaFile.hasAudio,
      isAudio: isAudioOnly,
      isVideo: !isAudioOnly,
      file: mediaFile.file,
    });

    // Set the standard drag data type
    event.dataTransfer.setData('application/x-media-file-id', mediaFileId);
    if (isAudioOnly) {
      event.dataTransfer.setData('application/x-media-is-audio', 'true');
    }
    event.dataTransfer.effectAllowed = 'copy';

    // Set drag image from the source element
    if (event.target instanceof HTMLElement) {
      event.dataTransfer.setDragImage(event.target, 10, 10);
    }
  }

  /**
   * Clean up drag state — call this in onDragEnd.
   */
  endDrag(): void {
    clearExternalDragPayload();
  }

  // ---------------------------------------------------------------------------
  // Direct timeline insertion
  // ---------------------------------------------------------------------------

  /**
   * Add a media file directly to the timeline at the current playhead position.
   * Finds (or creates) a suitable video/audio track and calls addClip.
   */
  async addToTimeline(mediaFileId: string): Promise<void> {
    const { useTimelineStore } = await import('../../stores/timeline');
    const timelineState = useTimelineStore.getState();
    const mediaState = useMediaStore.getState();

    const mediaFile = mediaState.files.find(f => f.id === mediaFileId);
    if (!mediaFile) {
      log.error('Media file not found for timeline insertion:', mediaFileId);
      return;
    }
    if (!mediaFile.file) {
      log.error('Media file has no File object (still importing?):', mediaFileId);
      return;
    }

    // Determine whether we need a video or audio track
    const isAudioOnly =
      mediaFile.file.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(mediaFile.file.name);
    const targetTrackType = isAudioOnly ? 'audio' : 'video';

    // Find the first track of the correct type, or create one
    let trackId = timelineState.tracks.find(t => t.type === targetTrackType)?.id;
    if (!trackId) {
      trackId = timelineState.addTrack(targetTrackType);
    }
    if (!trackId) {
      log.error('Failed to find or create a track for type:', targetTrackType);
      return;
    }

    const { playheadPosition } = timelineState;
    await timelineState.addClip(trackId, mediaFile.file, playheadPosition, mediaFile.duration, mediaFileId);

    log.info(`Added AI media ${mediaFileId} to timeline at ${playheadPosition.toFixed(2)}s`);
  }

  // ---------------------------------------------------------------------------
  // Metadata management (for project save/restore)
  // ---------------------------------------------------------------------------

  /**
   * Get generation metadata for a specific media file.
   */
  getMetadata(mediaFileId: string): FlashBoardGenerationMetadata | undefined {
    return this.generationMetadata.get(mediaFileId);
  }

  /**
   * Check if a media file was generated by FlashBoard.
   */
  isGeneratedMedia(mediaFileId: string): boolean {
    return this.generationMetadata.has(mediaFileId);
  }

  /**
   * Serialize all generation metadata for project save.
   */
  serializeMetadata(): Record<string, FlashBoardGenerationMetadata> {
    const result: Record<string, FlashBoardGenerationMetadata> = {};
    this.generationMetadata.forEach((meta: FlashBoardGenerationMetadata, id: string) => {
      result[id] = meta;
    });
    return result;
  }

  /**
   * Restore generation metadata from a saved project.
   */
  hydrateMetadata(data: Record<string, FlashBoardGenerationMetadata>): void {
    this.generationMetadata.clear();
    for (const [id, meta] of Object.entries(data)) {
      this.generationMetadata.set(id, meta);
    }
    log.debug(`Hydrated ${Object.keys(data).length} generation metadata entries`);
  }

  /**
   * Remove metadata for a media file (e.g., when the file is deleted from the pool).
   */
  removeMetadata(mediaFileId: string): void {
    this.generationMetadata.delete(mediaFileId);
  }
}

export const flashBoardMediaBridge = new FlashBoardMediaBridge();
