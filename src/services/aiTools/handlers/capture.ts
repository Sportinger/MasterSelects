import { screenCaptureService } from '../../capture/ScreenCaptureService';
import {
  getCaptureRecoveryStorage,
  readCaptureRecoveryEntries,
} from '../../capture/recording/recoveryPersistence';
import type { ToolResult } from '../types';

export async function handleGetCaptureState(): Promise<ToolResult> {
  return {
    success: true,
    data: {
      ...screenCaptureService.getDiagnosticState(),
      recovery: readCaptureRecoveryEntries(getCaptureRecoveryStorage()).map(entry => ({
        sessionId: entry.sessionId,
        status: entry.status,
        tier: entry.tier,
        startedAt: entry.startedAt,
        stoppedAt: entry.stoppedAt,
        mimeType: entry.mimeType,
        durationSeconds: entry.durationSeconds,
        bytes: entry.bytes,
        persistedParts: entry.chunks.length,
        positioned: entry.chunks.some(chunk => chunk.position !== undefined),
        recoverable: entry.recoverable,
        message: entry.message,
      })),
    },
  };
}
