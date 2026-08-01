#!/usr/bin/env node

import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureToolName = 'fixture_read_state';
const bridgeServer = createServer((request, response) => {
  const url = new URL(request.url || '/', 'http://127.0.0.1');
  response.setHeader('content-type', 'application/json');

  if (request.method === 'GET' && url.pathname === '/api/agent-control/sessions') {
    response.end(JSON.stringify({ success: true, data: { sessions: [] } }));
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/agent-control/tools') {
    response.end(JSON.stringify({
      success: true,
      data: {
        tools: [{
          definition: {
            function: {
              name: fixtureToolName,
              description: 'Read deterministic fixture state.',
              parameters: { type: 'object', properties: {}, additionalProperties: false },
            },
          },
          policy: { readOnly: true, riskLevel: 'low' },
        }],
      },
    }));
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/agent-control/call') {
    response.end(JSON.stringify({ success: true, data: { fixture: true } }));
    return;
  }

  response.statusCode = 404;
  response.end(JSON.stringify({ success: false, error: `Unexpected smoke request: ${request.method} ${url.pathname}` }));
});
await new Promise((resolve, reject) => {
  bridgeServer.once('error', reject);
  bridgeServer.listen(0, '127.0.0.1', resolve);
});
const bridgeAddress = bridgeServer.address();
if (!bridgeAddress || typeof bridgeAddress === 'string') {
  throw new Error('Could not resolve MCP smoke bridge address.');
}
const bridgeUrl = `http://127.0.0.1:${bridgeAddress.port}`;
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
    MASTERSELECTS_BRIDGE_URL: bridgeUrl,
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
    'bridge_call_tool',
    fixtureToolName,
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

  const tools = await client.callTool({
    name: 'bridge_list_tools',
    arguments: {},
  });
  assertSuccessfulTextResult(tools, 'bridge_list_tools');

  const fixture = await client.callTool({
    name: fixtureToolName,
    arguments: {},
  });
  assertSuccessfulTextResult(fixture, fixtureToolName);

  console.log(`MasterSelects MCP smoke passed (${listed.tools.length} tools).`);
} finally {
  await transport.close().catch(() => {});
  await new Promise((resolve) => bridgeServer.close(resolve));
}

function assertSuccessfulTextResult(result, toolName) {
  const text = result.content?.find((item) => item.type === 'text')?.text || '';
  if (result.isError || !text.includes('"success": true')) {
    throw new Error(`${toolName} failed: ${text || 'empty MCP response'}`);
  }
}
