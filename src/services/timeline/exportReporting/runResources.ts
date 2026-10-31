import type {
  RenderResourceDescriptor,
  TimelineRuntimeAdmissionDecision,
} from '../runtimeCoordinatorTypes';
import { createRenderResourceDescriptorFromDemand } from '../runtimeProviderDemandBridge';
import {
  EXPORT_POLICY_ID,
  canRetainExportResource,
  createExportDemand,
  getRunOwner,
  getRunResourceId,
  retainExportResource,
} from './core';
import type { ExportOutputSurfaceReport, ExportRunReport } from './types';
import { timelineRuntimeCoordinator } from '../timelineRuntimeCoordinator';

function createExportRunJobResource(report: ExportRunReport): RenderResourceDescriptor {
  const resourceId = getRunResourceId(report.runId, 'job:render');
  return createRenderResourceDescriptorFromDemand(createExportDemand({
    id: resourceId,
    resourceKind: 'job',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.settings.width,
      height: report.settings.stackedAlpha ? report.settings.height * 2 : report.settings.height,
      fps: report.settings.fps,
      durationSeconds: Math.max(0, report.settings.endTime - report.settings.startTime),
    },
    source: {
      previewPath: `${report.settings.startTime.toFixed(3)}-${report.settings.endTime.toFixed(3)}`,
    },
    tags: [
      'export',
      report.exportMode ?? report.settings.exportMode ?? 'unknown',
      report.requestedAudio ? 'audio-requested' : 'video-only',
      report.effectiveAudio ? 'audio-effective' : 'no-audio',
    ],
  }), {
    resourceKind: 'job',
    jobId: report.runId,
    jobKind: 'export-render',
    startedAtMs: report.startedAtMs,
    diagnostics: {
      status: 'ok',
      messages: [
        {
          severity: 'info',
          code: 'export.render-job',
          message: `Export ${report.exportMode ?? report.settings.exportMode ?? 'unknown'} render started.`,
          policyId: EXPORT_POLICY_ID,
        },
      ],
    },
    label: 'Export render job',
  });
}

export function canRetainExportRunJob(report: ExportRunReport): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportRunJobResource(report));
}

export function reportExportRunJob(report: ExportRunReport): void {
  retainExportResource(createExportRunJobResource(report));
  heldExportRunJobs.set(report.runId, {
    runId: report.runId,
    startedAtMs: report.startedAtMs ?? Date.now(),
    exportMode: report.exportMode ?? report.settings.exportMode ?? 'unknown',
    filename: report.settings.filename,
  });
}

/** Run jobs this tab holds, so a denied export can name what still occupies the export slot. */
export interface HeldExportRunJob {
  runId: string;
  startedAtMs: number;
  exportMode: string;
  filename?: string;
}

const heldExportRunJobs = new Map<string, HeldExportRunJob>();

export function forgetExportRunJob(runId: string): void {
  heldExportRunJobs.delete(runId);
}

/** Run jobs still retained in the runtime coordinator; entries cleared elsewhere drop out. */
export function listHeldExportRunJobs(): HeldExportRunJob[] {
  if (heldExportRunJobs.size === 0) return [];
  const retained = new Set(
    timelineRuntimeCoordinator.getBridgeStats().policies[EXPORT_POLICY_ID]?.resources.map((resource) => resource.id) ?? [],
  );
  for (const runId of heldExportRunJobs.keys()) {
    if (!retained.has(getRunResourceId(runId, 'job:render'))) heldExportRunJobs.delete(runId);
  }
  return [...heldExportRunJobs.values()];
}

/** Human-readable reason for a denied run job, e.g. "a fast export (video-bake-r1.mp4) started 4 min ago". */
export function describeHeldExportRunJobs(now = Date.now(), excludeRunId?: string): string | null {
  const held = listHeldExportRunJobs().filter((job) => job.runId !== excludeRunId);
  if (held.length === 0) return null;
  return held.map((job) => {
    const ageSeconds = Math.max(0, Math.round((now - job.startedAtMs) / 1000));
    const age = ageSeconds < 120 ? `${ageSeconds} s` : `${Math.round(ageSeconds / 60)} min`;
    const name = job.filename ? ` (${job.filename})` : '';
    return `a ${job.exportMode} export${name} started ${age} ago`;
  }).join(', ');
}

function createExportOutputSurfaceResource(
  report: ExportOutputSurfaceReport
): RenderResourceDescriptor {
  const height = report.stackedAlpha ? report.height * 2 : report.height;
  const resourceId = getRunResourceId(report.runId, 'output-surface');
  const demand = createExportDemand({
    id: resourceId,
    resourceKind: report.zeroCopy ? 'gpu-texture' : 'image-canvas',
    owner: getRunOwner(report.runId),
    dimensions: {
      width: report.width,
      height,
    },
    tags: ['export', report.zeroCopy ? 'zero-copy' : 'readback', 'output-surface'],
  });

  if (report.zeroCopy) {
    return createRenderResourceDescriptorFromDemand(demand, {
      resourceKind: 'gpu-texture',
      textureId: resourceId,
      textureKind: 'export-frame',
      format: 'rgba8unorm',
      memoryCost: {
        gpuBytes: report.width * height * 4,
      },
      label: 'Export zero-copy output surface',
    });
  }

  return createRenderResourceDescriptorFromDemand(demand, {
    resourceKind: 'image-canvas',
    imageKind: 'offscreen-canvas',
    imageId: resourceId,
    memoryCost: {
      heapBytes: report.width * height * 4,
    },
    label: 'Export readback output surface',
  });
}

export function canRetainExportOutputSurface(
  report: ExportOutputSurfaceReport
): TimelineRuntimeAdmissionDecision {
  return canRetainExportResource(createExportOutputSurfaceResource(report));
}

export function reportExportOutputSurface(report: ExportOutputSurfaceReport): void {
  retainExportResource(createExportOutputSurfaceResource(report));
}
