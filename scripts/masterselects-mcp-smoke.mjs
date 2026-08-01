#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const client = new Client({
  name: 'masterselects-mcp-smoke',
  version: '1.0.0',
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(projectRoot, 'scripts', 'masterselects-mcp.mjs')],
  cwd: projectRoot,
  env: {
    ...process.env,
    MASTERSELECTS_BRIDGE_URL: process.env.MASTERSELECTS_BRIDGE_URL || 'http://localhost:5173',
  },
  stderr: 'pipe',
});

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = new Set(listed.tools.map((tool) => tool.name));
  for (const expected of [
    'bridge_list_sessions',
    'bridge_list_tools',
    'bridge_get_history',
    'bridge_replay_tool_call',
    'getTimelineState',
  ]) {
    if (!names.has(expected)) {
      throw new Error(`Missing MCP tool: ${expected}`);
    }
  }

  const sessions = await client.callTool({
    name: 'bridge_list_sessions',
    arguments: {},
  });
  assertSuccessfulTextResult(sessions, 'bridge_list_sessions');

  const timeline = await client.callTool({
    name: 'getTimelineState',
    arguments: {},
  });
  assertSuccessfulTextResult(timeline, 'getTimelineState');

  console.log(`MasterSelects MCP smoke passed (${listed.tools.length} tools).`);
} finally {
  await transport.close().catch(() => {});
}

function assertSuccessfulTextResult(result, toolName) {
  const text = result.content?.find((item) => item.type === 'text')?.text || '';
  if (result.isError || !text.includes('"success": true')) {
    throw new Error(`${toolName} failed: ${text || 'empty MCP response'}`);
  }
}
