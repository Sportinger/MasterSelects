import { describeImageLoadFailure } from '../compositionRender/imageLoadFailure';
import { Logger } from '../logger';
import { useMediaStore } from '../../stores/mediaStore';

/**
 * Shared report path for still images the browser cannot decode (damaged,
 * truncated, HEIC on an unsupported browser, revoked file access). Import,
 * clip placement and the main preview image loader all report here, so a
 * broken image produces one explained warning per file and a visible
 * `decodeError` on its media item instead of silently rendering nothing.
 */

const log = Logger.create('ImageDecode');

export interface ImageDecodeFailureInput {
  name: string;
  file?: File;
  mediaFileId?: string;
}

const reportedFailureMessages = new Map<string, string>();

function getFailureKey(input: ImageDecodeFailureInput): string {
  // Name and size survive the RAW-copy promotion during import, so the import
  // probe and later preview loads of the same file share one warning.
  return `${input.name}:${input.file?.size ?? 'no-file'}`;
}

function setMediaFileDecodeError(mediaFileId: string, decodeError: string | undefined): void {
  useMediaStore.setState((state) => {
    const needsUpdate = state.files.some((file) => (
      file.id === mediaFileId && file.decodeError !== decodeError
    ));
    if (!needsUpdate) return state;
    return {
      files: state.files.map((file) => (
        file.id === mediaFileId ? { ...file, decodeError } : file
      )),
    };
  });
}

/**
 * Logs one explained warning per broken image and marks its media item.
 * Resolves to the explanation so callers can store or surface it.
 */
export async function reportImageDecodeFailure(input: ImageDecodeFailureInput): Promise<string> {
  const key = getFailureKey(input);
  let message = reportedFailureMessages.get(key);
  if (!message) {
    message = await describeImageLoadFailure({ file: input.file, name: input.name });
    if (!reportedFailureMessages.has(key)) {
      reportedFailureMessages.set(key, message);
      log.warn(`Image cannot be shown, the preview renders without it: ${message}`);
    }
  }
  if (input.mediaFileId) {
    setMediaFileDecodeError(input.mediaFileId, message);
  }
  return message;
}

/** Clears a previous failure once the same media decodes (relink, retry, transient memory pressure). */
export function clearImageDecodeFailure(input: ImageDecodeFailureInput): void {
  reportedFailureMessages.delete(getFailureKey(input));
  if (input.mediaFileId) {
    setMediaFileDecodeError(input.mediaFileId, undefined);
  }
}

export function resetImageDecodeFailureReportsForTests(): void {
  reportedFailureMessages.clear();
}
