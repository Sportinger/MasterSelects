import { isAgentRequestRevisionSource } from '../transaction/historyNavigationPlan';

/** Human label for a revision's source in the History panel. */
export function revisionSourceDisplayLabel(value: string): string {
  // One assistant request's revisions carry 'agent-request:<runId>'; the run id means nothing to a reader.
  if (isAgentRequestRevisionSource(value)) return 'Agent request';
  const sources: Record<string, string> = { user: 'Edit', gesture: 'Edit', background: 'Background task',
    'source-identity': 'Media verification', import: 'Import', project: 'Project change' };
  if (sources[value]) return sources[value];
  if (!/^[a-z][A-Za-z0-9_]*$/u.test(value)) return value;
  const words = value.replace(/([a-z0-9])([A-Z])/gu, '$1 $2').replace(/_/gu, ' ').toLowerCase();
  return words[0].toUpperCase() + words.slice(1);
}
