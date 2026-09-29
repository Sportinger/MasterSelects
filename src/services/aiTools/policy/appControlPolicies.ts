import type { ToolPolicyEntry } from './types';

/** Desktop-level development controls; never available to provider chat. */
const interaction = (): ToolPolicyEntry => ({
  readOnly: false,
  riskLevel: 'medium',
  requiresConfirmation: true,
  sensitiveDataAccess: true,
  localFileAccess: false,
  allowedCallers: ['devBridge', 'console', 'internal'],
});

export const APP_CONTROL_POLICIES: Array<[string, ToolPolicyEntry]> = [
  ['profileAppInteraction', interaction()],
  ['clickAppControl', interaction()],
  ['fillAppControl', interaction()],
  ['probeSameOriginRequest', interaction()],
  ['captureAppScreenshot', { ...interaction(), readOnly: true, riskLevel: 'low', requiresConfirmation: false }],
  ['openLocalProject', {
    readOnly: false,
    riskLevel: 'high',
    requiresConfirmation: true,
    sensitiveDataAccess: true,
    localFileAccess: true,
    allowedCallers: ['devBridge', 'internal'],
  }],
];
