import {
  runRenderCapabilityProbe,
  type RenderCapabilityProbeResult,
} from '../render/renderCapabilityProbe';
import type { ToolResult } from './types';

export interface WorkerFirstCapabilityProbeBridgeDeps {
  readonly runProbe: () => Promise<RenderCapabilityProbeResult>;
}

const DEFAULT_DEPS: WorkerFirstCapabilityProbeBridgeDeps = {
  runProbe: () => runRenderCapabilityProbe(),
};

function hasCallerProbeFields(args: Record<string, unknown>): boolean {
  return Object.keys(args).length > 0;
}

export async function handleRunWorkerFirstRenderCapabilityProbe(
  args: Record<string, unknown>,
  deps: WorkerFirstCapabilityProbeBridgeDeps = DEFAULT_DEPS,
): Promise<ToolResult> {
  if (hasCallerProbeFields(args)) {
    return {
      success: false,
      error: 'Render capability probe evidence must be collected in-browser and cannot be caller-supplied.',
    };
  }

  try {
    const capabilityProbe = await deps.runProbe();
    return {
      success: true,
      data: {
        capabilityProbe,
        selectedStrategy: capabilityProbe.selectedStrategy,
        w5StartPermissionsRemainStatsGuarded: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to run render capability probe.',
    };
  }
}
