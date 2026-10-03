import type { ToolPolicyEntry } from './types';

const ruleMutation: ToolPolicyEntry = {
  readOnly: false, riskLevel: 'medium', requiresConfirmation: false,
  sensitiveDataAccess: false, localFileAccess: false,
  allowedCallers: ['chat', 'devBridge', 'kernel', 'console', 'internal'],
};

export const COMPOSITION_RULE_POLICIES: Array<[string, ToolPolicyEntry]> = [
  ['startClipBeatAnalysis', { ...ruleMutation, riskLevel: 'low' }],
  ['getCompositionGraph', { ...ruleMutation, readOnly: true, riskLevel: 'low' }],
  ['createBeatRule', { ...ruleMutation }],
  ['updateBeatRule', { ...ruleMutation }],
  ['releaseBeatRuleMember', { ...ruleMutation }],
  ['materializeBeatRule', { ...ruleMutation }],
];
