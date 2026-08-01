import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { downloadBlob } from '../../../engine/export';
import { Logger } from '../../../services/logger';
import { resolveMediaFileForTimelineDrop } from '../../../services/timeline/timelineExternalDropMediaResolver';
import type { MediaFile } from '../../../stores/mediaStore';
import type { BatchExportJob } from '../../../stores/exportStore';
import {
  BatchSourceExportRunner,
  isBatchSourceExportCancelledError,
  type BatchSourceMediaType,
} from './index';
import type { BatchExportRuntimeMap, BatchExportRuntimeState } from './batchRuntimeTypes';

const log = Logger.create('BatchExportController');

interface UseBatchExportControllerInput {
  jobs: BatchExportJob[];
  mediaFiles: MediaFile[];
}

function readyRuntime(): BatchExportRuntimeState {
  return { status: 'queued', progress: 0 };
}

function isSupportedMediaType(type: MediaFile['type']): type is BatchSourceMediaType {
  return type === 'video' || type === 'audio' || type === 'image';
}

export function useBatchExportController({ jobs, mediaFiles }: UseBatchExportControllerInput) {
  const [runtimeByJob, setRuntimeByJob] = useState<BatchExportRuntimeMap>({});
  const [isRunning, setIsRunning] = useState(false);
  const runnerRef = useRef<BatchSourceExportRunner | null>(null);
  const cancelRequestedRef = useRef(false);

  useEffect(() => () => {
    cancelRequestedRef.current = true;
    void runnerRef.current?.cancel();
  }, []);

  const setJobRuntime = useCallback((jobId: string, runtime: BatchExportRuntimeState) => {
    setRuntimeByJob((current) => ({ ...current, [jobId]: runtime }));
  }, []);

  const runBatch = useCallback(async () => {
    if (isRunning || jobs.length === 0) return;

    cancelRequestedRef.current = false;
    setIsRunning(true);
    setRuntimeByJob(Object.fromEntries(jobs.map((job) => [job.id, readyRuntime()])));

    try {
      for (const job of jobs) {
        if (cancelRequestedRef.current) break;

        const mediaFile = mediaFiles.find((candidate) => candidate.id === job.mediaFileId);
        if (!mediaFile || !isSupportedMediaType(mediaFile.type) || mediaFile.type !== job.mediaType) {
          setJobRuntime(job.id, {
            status: 'failed',
            progress: 0,
            error: !mediaFile
              ? 'Source file is missing from the project'
              : mediaFile.type !== job.mediaType
                ? 'Source media type changed. Remove the job and add the file again.'
                : 'Unsupported media type',
          });
          continue;
        }

        setJobRuntime(job.id, { status: 'resolving', progress: 0, phase: 'Opening source' });
        const sourceFile = await resolveMediaFileForTimelineDrop(mediaFile);
        if (cancelRequestedRef.current) {
          setJobRuntime(job.id, { status: 'cancelled', progress: 0 });
          break;
        }
        if (!sourceFile) {
          setJobRuntime(job.id, {
            status: 'failed',
            progress: 0,
            error: 'Source file could not be opened. Relink it in the Media panel and retry.',
          });
          continue;
        }

        const runner = new BatchSourceExportRunner();
        runnerRef.current = runner;
        try {
          const result = await runner.run({
            file: sourceFile,
            mediaType: job.mediaType,
            settings: job.settings,
            outputName: job.settings.filename,
          }, ({ progress, phase }) => {
            setJobRuntime(job.id, {
              status: 'encoding',
              progress,
              phase,
            });
          });

          if (cancelRequestedRef.current) {
            setJobRuntime(job.id, { status: 'cancelled', progress: 0 });
            break;
          }

          downloadBlob(result.blob, result.filename);
          setJobRuntime(job.id, { status: 'completed', progress: 100, phase: 'complete' });
        } catch (error) {
          if (cancelRequestedRef.current || isBatchSourceExportCancelledError(error)) {
            setJobRuntime(job.id, { status: 'cancelled', progress: 0 });
            break;
          }
          const message = error instanceof Error ? error.message : 'Batch export failed';
          log.error(`Batch source export failed for ${job.sourceName}`, error);
          setJobRuntime(job.id, { status: 'failed', progress: 0, error: message });
        } finally {
          runnerRef.current = null;
        }
      }
    } finally {
      runnerRef.current = null;
      setIsRunning(false);
    }
  }, [isRunning, jobs, mediaFiles, setJobRuntime]);

  const cancelBatch = useCallback(() => {
    cancelRequestedRef.current = true;
    void runnerRef.current?.cancel();
  }, []);

  const overallProgress = useMemo(() => {
    if (jobs.length === 0) return 0;
    const total = jobs.reduce((sum, job) => {
      const runtime = runtimeByJob[job.id];
      return sum + (runtime?.status === 'completed' ? 100 : runtime?.progress ?? 0);
    }, 0);
    return total / jobs.length;
  }, [jobs, runtimeByJob]);

  const failedCount = useMemo(() => (
    jobs.filter((job) => runtimeByJob[job.id]?.status === 'failed').length
  ), [jobs, runtimeByJob]);

  return {
    runtimeByJob,
    isRunning,
    overallProgress,
    failedCount,
    runBatch,
    cancelBatch,
  };
}
