import type { FileImportResult } from '../../stores/mediaStore/types';
import { bucketRuntime } from './domainEvents';
import {
  classifyProductAnalyticsFailure,
  type ProductAnalyticsMediaImportFailureStage,
} from './failureClassification';
import { productAnalytics } from './index';

export type MediaImportAnalyticsSource = 'handles' | 'input_or_drop' | 'picker';

export interface MediaImportAnalyticsContext {
  trackFailure: (
    error: unknown,
    stage: ProductAnalyticsMediaImportFailureStage,
    requestedCount?: number,
  ) => void;
  withStage: <T>(
    stage: ProductAnalyticsMediaImportFailureStage,
    operation: () => Promise<T>,
  ) => Promise<T>;
}

function bucketTotalSize(files: readonly File[]): string {
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, file.size), 0);
  if (totalBytes === 0) return 'zero';
  if (totalBytes < 10 * 1024 ** 2) return 'under_10mb';
  if (totalBytes < 100 * 1024 ** 2) return '10_100mb';
  if (totalBytes < 1024 ** 3) return '100mb_1gb';
  if (totalBytes < 10 * 1024 ** 3) return '1_10gb';
  return '10gb_plus';
}
function countMediaKinds(files: readonly File[]) {
  let audioCount = 0;
  let imageCount = 0;
  let videoCount = 0;
  let otherCount = 0;
  for (const file of files) {
    if (file.type.startsWith('video/')) videoCount += 1;
    else if (file.type.startsWith('audio/')) audioCount += 1;
    else if (file.type.startsWith('image/')) imageCount += 1;
    else otherCount += 1;
  }
  return { audioCount, imageCount, otherCount, videoCount };
}

export async function withMediaImportAnalytics(
  files: readonly File[],
  source: MediaImportAnalyticsSource,
  run: (analytics: MediaImportAnalyticsContext) => Promise<FileImportResult[]>,
): Promise<FileImportResult[]> {
  const startedAt = Date.now();
  const stagedErrors = new WeakMap<object, ProductAnalyticsMediaImportFailureStage>();
  let primitiveErrorStage: ProductAnalyticsMediaImportFailureStage = 'unknown';
  const counts = countMediaKinds(files);
  productAnalytics.track('media_import_started', {
    audio_count: counts.audioCount,
    file_count: files.length,
    image_count: counts.imageCount,
    other_count: counts.otherCount,
    size_bucket: bucketTotalSize(files),
    source,
    video_count: counts.videoCount,
  });

  const trackFailure: MediaImportAnalyticsContext['trackFailure'] = (
    error,
    stage,
    requestedCount = 1,
  ) => {
    productAnalytics.track('media_import_failed', {
      failure_code: classifyProductAnalyticsFailure(error),
      failure_stage: stage,
      requested_count: requestedCount,
      runtime_bucket: bucketRuntime(Date.now() - startedAt),
      source,
    });
  };
  const withStage: MediaImportAnalyticsContext['withStage'] = async (stage, operation) => {
    try {
      return await operation();
    } catch (error) {
      if ((typeof error === 'object' && error !== null) || typeof error === 'function') {
        stagedErrors.set(error, stage);
      } else {
        primitiveErrorStage = stage;
      }
      throw error;
    }
  };

  try {
    const result = await run({ trackFailure, withStage });
    productAnalytics.track('media_import_completed', {
      imported_count: result.length,
      requested_count: files.length,
      runtime_bucket: bucketRuntime(Date.now() - startedAt),
      source,
    });
    return result;
  } catch (error) {
    const stage = ((typeof error === 'object' && error !== null) || typeof error === 'function')
      ? stagedErrors.get(error) ?? 'unknown'
      : primitiveErrorStage;
    trackFailure(error, stage, files.length);
    throw error;
  }
}

export function trackMediaImportPickerCancelled(): void {
  productAnalytics.track('media_import_cancelled', { source: 'picker' });
}
