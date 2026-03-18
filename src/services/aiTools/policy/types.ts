// AI Tool Policy Types

export type RiskLevel = 'low' | 'medium' | 'high';
export type CallerContext = 'chat' | 'devBridge' | 'nativeHelper' | 'console' | 'internal';

export interface ToolPolicyEntry {
  readOnly: boolean;
  riskLevel: RiskLevel;
  requiresConfirmation: boolean;
  sensitiveDataAccess: boolean;
  localFileAccess: boolean;
  allowedCallers: CallerContext[];
}
