import { describe, expect, it } from 'vitest';
import { buildDirectCodexDynamicTools } from '../../src/services/flashboard/FlashBoardDirectCodexTransport';
import { localDirectToolResult } from '../../src/services/flashboard/FlashBoardDirectToolSurface';
import { AI_TOOLS } from '../../src/services/aiTools';

type Entry = { name: string; description: string; inputSchema: Record<string, unknown>; deferLoading?: boolean };
const entries = (deferLoading: boolean) => (buildDirectCodexDynamicTools(undefined, deferLoading)[0].tools as Entry[]);

describe('compact Direct tool surface', () => {
  it('keeps everyday schemas, lists the rest by one line and drops dev-only tools', () => {
    const compact = entries(false), full = entries(true);
    expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 2);
    const byName = new Map(compact.map(entry => [entry.name, entry]));
    expect(byName.get('editOperatorGraph')?.inputSchema).toHaveProperty('properties.action');
    expect(byName.get('createTextClip')?.inputSchema).toEqual({ type: 'object', additionalProperties: true });
    expect(byName.get('createTextClip')?.description).toContain('getToolSchema');
    expect(byName.has('getToolSchema')).toBe(true);
    expect([...byName.keys()].some(name => name.startsWith('runWorkerFirst') || name === 'clickAppControl')).toBe(false);
    expect(compact.some(entry => entry.deferLoading)).toBe(false);
  });

  it('describes requested tools on demand without reaching editor execution', () => {
    const definitions = new Map(AI_TOOLS.map(tool => [tool.function.name, tool]));
    const result = localDirectToolResult('getToolSchema', JSON.stringify({ names: ['createTextClip', 'clickAppControl', 'nope'] }), definitions);
    expect(result?.success).toBe(true);
    expect(result?.data).toMatchObject({ tools: [expect.objectContaining({ name: 'createTextClip' })], missing: ['clickAppControl', 'nope'] });
    expect(localDirectToolResult('getTimelineState', '{}', definitions)).toBeUndefined();
  });
});
