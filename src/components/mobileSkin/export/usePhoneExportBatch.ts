// The batch queue on the phone: the project's batch jobs (exportStore.batch, the same queue the
// desktop export panel shows), run one after another through the editor's BatchSourceExportRunner.
// Unlike the desktop it keeps each finished file for Save/Share instead of downloading at once,
// and Retry runs only the jobs that failed or were cancelled.
import { useCallback, useEffect, useRef, useState } from 'react';
import { BatchSourceExportRunner, isBatchSourceExportCancelledError } from '../../export/batch';
import type { BatchExportRuntimeState } from '../../export/batch/batchRuntimeTypes';
import { useExportScreenWakeLock } from '../../../hooks/useExportScreenWakeLock';
import { Logger } from '../../../services/logger';
import { resolveMediaFileForTimelineDrop } from '../../../services/timeline/timelineExternalDropMediaResolver';
import { useExportStore, type BatchExportJob, type BatchExportMediaType } from '../../../stores/exportStore';
import { useMediaStore, type MediaFile } from '../../../stores/mediaStore';

const log = Logger.create('PhoneExportBatch');

export interface PhoneBatchResult {
  blob: Blob;
  filename: string;
}

export interface PhoneBatchSource {
  id: string;
  name: string;
  mediaType: BatchExportMediaType;
  queued: boolean;
}

export function isBatchMediaType(type: MediaFile['type']): type is BatchExportMediaType {
  return type === 'video' || type === 'audio' || type === 'image';
}

/** Jobs a Retry runs again: failed or cancelled ones. */
export function selectRetryJobs(jobs: readonly BatchExportJob[], runtime: Readonly<Record<string, BatchExportRuntimeState>>): BatchExportJob[] {
  return jobs.filter((job) => runtime[job.id]?.status === 'failed' || runtime[job.id]?.status === 'cancelled');
}

export function usePhoneExportBatch() {
  const jobs = useExportStore((store) => store.batch.jobs);
  const files = useMediaStore((store) => store.files);
  const [runtime, setRuntime] = useState<Record<string, BatchExportRuntimeState>>({});
  const [results, setResults] = useState<Record<string, PhoneBatchResult>>({});
  const [running, setRunning] = useState(false);
  const runnerRef = useRef<BatchSourceExportRunner | null>(null);
  const cancelRef = useRef(false);
  const mountedRef = useRef(true);
  useExportScreenWakeLock(running);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelRef.current = true;
      void runnerRef.current?.cancel();
    };
  }, []);

  const setJob = useCallback((jobId: string, state: BatchExportRuntimeState) => {
    if (mountedRef.current) setRuntime((current) => ({ ...current, [jobId]: state }));
  }, []);

  const queuedIds = new Set(jobs.map((job) => job.mediaFileId));
  const sources: PhoneBatchSource[] = files.flatMap((file) => (isBatchMediaType(file.type)
    ? [{ id: file.id, name: file.name, mediaType: file.type, queued: queuedIds.has(file.id) }]
    : []));

  const addSource = useCallback((source: PhoneBatchSource) => {
    useExportStore.getState().enqueueBatchJobs([{ mediaFileId: source.id, sourceName: source.name, mediaType: source.mediaType }]);
  }, []);

  const removeJob = useCallback((jobId: string) => {
    if (running) return;
    useExportStore.getState().removeBatchJob(jobId);
    setResults(({ [jobId]: _removed, ...rest }) => rest);
  }, [running]);

  const clearJobs = useCallback(() => {
    if (running) return;
    useExportStore.getState().clearBatchJobs();
    setResults({});
    setRuntime({});
  }, [running]);

  const runJobs = useCallback(async (toRun: readonly BatchExportJob[]) => {
    if (running || toRun.length === 0) return;
    cancelRef.current = false;
    setRunning(true);
    setRuntime((current) => ({ ...current, ...Object.fromEntries(toRun.map((job) => [job.id, { status: 'queued', progress: 0 }])) }));
    try {
      for (const job of toRun) {
        if (cancelRef.current) {
          setJob(job.id, { status: 'cancelled', progress: 0 });
          continue;
        }
        const mediaFile = useMediaStore.getState().files.find((file) => file.id === job.mediaFileId);
        if (!mediaFile || mediaFile.type !== job.mediaType) {
          setJob(job.id, { status: 'failed', progress: 0, error: mediaFile ? 'The source changed type. Remove the job and add it again.' : 'The source is no longer in the project.' });
          continue;
        }
        setJob(job.id, { status: 'resolving', progress: 0, phase: 'Opening source' });
        const sourceFile = await resolveMediaFileForTimelineDrop(mediaFile);
        if (!sourceFile) {
          setJob(job.id, { status: 'failed', progress: 0, error: 'The source file could not be opened. Relink it, then retry.' });
          continue;
        }
        const runner = new BatchSourceExportRunner();
        runnerRef.current = runner;
        try {
          const result = await runner.run(
            { file: sourceFile, mediaType: job.mediaType, settings: job.settings, outputName: job.settings.filename },
            ({ progress, phase }) => setJob(job.id, { status: 'encoding', progress, phase }),
          );
          if (cancelRef.current) {
            setJob(job.id, { status: 'cancelled', progress: 0 });
            continue;
          }
          if (mountedRef.current) setResults((current) => ({ ...current, [job.id]: { blob: result.blob, filename: result.filename } }));
          setJob(job.id, { status: 'completed', progress: 100, phase: 'complete' });
        } catch (error) {
          if (cancelRef.current || isBatchSourceExportCancelledError(error)) {
            setJob(job.id, { status: 'cancelled', progress: 0 });
            continue;
          }
          log.error(`Batch export failed for ${job.sourceName}`, error);
          setJob(job.id, { status: 'failed', progress: 0, error: error instanceof Error ? error.message : 'Batch export failed.' });
        } finally {
          runnerRef.current = null;
        }
      }
    } finally {
      runnerRef.current = null;
      if (mountedRef.current) setRunning(false);
    }
  }, [running, setJob]);

  const runAll = useCallback(() => runJobs(useExportStore.getState().batch.jobs), [runJobs]);
  const retryFailed = useCallback(() => runJobs(selectRetryJobs(useExportStore.getState().batch.jobs, runtime)), [runJobs, runtime]);
  const cancel = useCallback(() => {
    cancelRef.current = true;
    void runnerRef.current?.cancel();
  }, []);

  return {
    jobs,
    sources,
    runtime,
    results,
    running,
    retryCount: selectRetryJobs(jobs, runtime).length,
    addSource,
    removeJob,
    clearJobs,
    runAll,
    retryFailed,
    cancel,
  };
}
