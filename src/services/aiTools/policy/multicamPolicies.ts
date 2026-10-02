import type { ToolPolicyEntry } from './types';

/** Multicam editing: background audio sync of timeline clips and the multicam cut mode. */
const editing = (readOnly: boolean): ToolPolicyEntry => ({
  readOnly,
  riskLevel: readOnly ? 'low' : 'medium',
  requiresConfirmation: false,
  sensitiveDataAccess: false,
  localFileAccess: false,
  allowedCallers: ['chat', 'devBridge', 'console', 'internal'],
});

export const MULTICAM_POLICIES: Array<[string, ToolPolicyEntry]> = [
  ['syncClipsViaAudio', editing(false)],
  ['getAudioSyncStatus', editing(true)],
  ['setMulticamMode', editing(false)],
];
