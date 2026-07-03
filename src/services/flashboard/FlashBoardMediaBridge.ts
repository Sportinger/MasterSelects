import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';
import { requireMediaFileImportResult } from '../../stores/mediaStore/helpers/importResult';
import { captureCurrentPreviewFrameFile } from '../previewFrameCapture';
import {
  completeFlashBoardActiveGenerationRecord,
  getFlashBoardActiveGenerationRecord,
  type FlashBoardActiveGenerationRecord,
} from '../../stores/flashboardStore/activeGenerationRecords';
import type {
  FlashBoardGenerationMetadata,
  FlashBoardMediaType,
  FlashBoardResult,
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

function isFetchNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /failed to fetch|networkerror|load failed/i.test(error.message);
}

/**
 * FlashBoardMediaBridge handles importing AI-generated media into the Media Pool
 * and provides timeline integration (drag protocol, direct add-to-timeline).
 *
 * Lifecycle:
 *   1. Job completes with a videoUrl
 *   2. Bridge downloads the video as a File
 *   3. Bridge imports the File into the Media Pool under "AI Gen / Video" (or "Images")
 *   4. Bridge updates the FlashBoard record with the result (mediaFileId, dimensions, duration)
 *   5. Bridge stores generation metadata keyed by mediaFileId for project persistence
 *
 * The imported media is then draggable to the timeline using the standard
 * `application/x-media-file-id` drag protocol.
 */
class FlashBoardMediaBridge {
  private generationMetadata: Map<string, FlashBoardGenerationMetadata> = new Map();
  private recordImports: Map<string, Promise<FlashBoardResult>> = new Map();

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
    let response: Response;
    try {
      response = await fetch(url);
    } catch (error) {
      if (isFetchNetworkError(error)) {
        throw new Error('Could not download generated media from the provider. The media URL was unreachable or blocked; try again.');
      }
      throw error;
    }
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
    record: FlashBoardActiveGenerationRecord | undefined,
    mediaType: FlashBoardMediaType,
  ): FlashBoardGenerationMetadata | null {
    if (!record?.request) {
      return null;
    }

    return {
      mediaFileId,
      service: record.request.service,
      providerId: record.request.providerId,
      version: record.request.version,
      outputType: record.request.outputType,
      mediaType,
      prompt: record.request.prompt,
      negativePrompt: record.request.negativePrompt,
      duration: record.request.duration,
      aspectRatio: record.request.aspectRatio,
      imageSize: record.request.imageSize,
      generateAudio: record.request.generateAudio,
      multiShots: record.request.multiShots,
      multiPrompt: record.request.multiPrompt,
      voiceId: record.request.voiceId,
      voiceName: record.request.voiceName,
      languageOverride: record.request.languageOverride,
      languageCode: record.request.languageCode,
      outputFormat: record.request.outputFormat,
      voiceSettings: record.request.voiceSettings,
      sunoCustomMode: record.request.sunoCustomMode,
      sunoInstrumental: record.request.sunoInstrumental,
      sunoStyle: record.request.sunoStyle,
      sunoTitle: record.request.sunoTitle,
      sunoNegativeTags: record.request.sunoNegativeTags,
      sunoVocalGender: record.request.sunoVocalGender,
      sunoStyleWeight: record.request.sunoStyleWeight,
      sunoWeirdnessConstraint: record.request.sunoWeirdnessConstraint,
      sunoAudioWeight: record.request.sunoAudioWeight,
      startMediaFileId: record.request.startMediaFileId,
      endMediaFileId: record.request.endMediaFileId,
      referenceMediaFileIds: record.request.referenceMediaFileIds ?? [],
      createdAt: new Date().toISOString(),
    };
  }

  async importGeneratedFile(
    recordId: string,
    file: File,
    mediaType: FlashBoardMediaType,
  ): Promise<FlashBoardResult> {
    return this.runSingleRecordImport(recordId, () => this.importGeneratedFileOnce(recordId, file, mediaType));
  }

  private async runSingleRecordImport(
    recordId: string,
    importMedia: () => Promise<FlashBoardResult>,
  ): Promise<FlashBoardResult> {
    const existingResult = getFlashBoardActiveGenerationRecord(recordId)?.result;
    if (existingResult) {
      return existingResult;
    }

    const existingImport = this.recordImports.get(recordId);
    if (existingImport) {
      return existingImport;
    }

    const importPromise = importMedia();
    this.recordImports.set(recordId, importPromise);
    try {
      return await importPromise;
    } finally {
      if (this.recordImports.get(recordId) === importPromise) {
        this.recordImports.delete(recordId);
      }
    }
  }

  private async importGeneratedFileOnce(
    recordId: string,
    file: File,
    mediaType: FlashBoardMediaType,
  ): Promise<FlashBoardResult> {
    const record = getFlashBoardActiveGenerationRecord(recordId);
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

    const metadata = this.buildMetadata(mediaFile.id, record, mediaType);
    if (metadata) {
      this.generationMetadata.set(mediaFile.id, metadata);
    }

    completeFlashBoardActiveGenerationRecord(recordId, result);

    log.info(`Imported AI ${mediaType}: ${file.name} -> ${mediaFile.id}`);
    return result;
  }

  async importGeneratedMedia(
    recordId: string,
    videoUrl: string,
    mediaType: FlashBoardMediaType = 'video'
  ): Promise<FlashBoardResult> {
    return this.runSingleRecordImport(recordId, async () => {
      return this.importGeneratedMediaOnce(recordId, videoUrl, mediaType);
    });
  }

  private async importGeneratedMediaOnce(
    recordId: string,
    videoUrl: string,
    mediaType: FlashBoardMediaType = 'video'
  ): Promise<FlashBoardResult> {
    // Look up the record to get prompt/request info
    const record = getFlashBoardActiveGenerationRecord(recordId);
    const prompt = record?.request?.prompt ?? '';

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
      log.error(`Failed to download media for record ${recordId}: ${message}`);
      throw err;
    }

    return this.importGeneratedFileOnce(recordId, file, mediaType);
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

    event.dataTransfer.setData('application/x-media-file-id', mediaFileId);

    const mediaFile = useMediaStore.getState().files.find(f => f.id === mediaFileId);
    if (!mediaFile || mediaFile.isImporting) {
      log.warn('Cannot start drag — media file not ready:', mediaFileId);
      return;
    }

    // Set the ExternalDragPayload so the timeline drop handler can resolve it
    const isAudioOnly =
      mediaFile.type === 'audio' ||
      mediaFile.file?.type.startsWith('audio/') ||
      /\.(mp3|wav|ogg|aac|m4a|flac|wma|aiff|alac|opus)$/i.test(mediaFile.file?.name ?? mediaFile.name);

    setExternalDragPayload({
      kind: 'media-file',
      id: mediaFile.id,
      duration: mediaFile.duration,
      hasAudio: mediaFile.type === 'image' ? false : isAudioOnly ? true : mediaFile.hasAudio,
      isAudio: isAudioOnly,
      isVideo: !isAudioOnly,
      file: mediaFile.file,
    });

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
