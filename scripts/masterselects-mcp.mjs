#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseUrl = (process.env.MASTERSELECTS_BRIDGE_URL || 'http://localhost:5173').replace(/\/+$/, '');
const tokenPath = process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE
  ? path.resolve(process.env.MASTERSELECTS_BRIDGE_TOKEN_FILE)
  : path.join(projectRoot, '.ai-bridge-token');
const defaultSurface = process.env.MASTERSELECTS_BRIDGE_SURFACE === 'devBridge'
  ? 'devBridge'
  : 'chat';
const defaultTimeoutMs = normalizeTimeout(process.env.MASTERSELECTS_BRIDGE_TIMEOUT_MS, 60_000);

let selectedSessionId = process.env.MASTERSELECTS_BRIDGE_SESSION_ID?.trim() || null;
let cachedRemoteTools = [];

const CONTROL_TOOLS = [
  {
    name: 'bridge_list_sessions',
    description: 'List connected MasterSelects browser sessions with project, chat, focus, and tool-count metadata.',
    inputSchema: objectSchema({}),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_select_session',
    description: 'Select the browser session used by direct MasterSelects tool calls in this MCP process.',
    inputSchema: objectSchema({
      sessionId: { type: 'string', description: 'Opaque session id returned by bridge_list_sessions.' },
    }, ['sessionId']),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_list_tools',
    description: 'List the exact live MasterSelects tool schemas and policies for the chat or devBridge execution surface.',
    inputSchema: objectSchema({
      sessionId: { type: 'string' },
      surface: { type: 'string', enum: ['chat', 'devBridge'], default: defaultSurface },
    }),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_get_tool_schema',
    description: 'Get one exact live MasterSelects tool schema plus its execution policy.',
    inputSchema: objectSchema({
      name: { type: 'string' },
      sessionId: { type: 'string' },
      surface: { type: 'string', enum: ['chat', 'devBridge'], default: defaultSurface },
    }, ['name']),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_call_tool',
    description: 'Call a MasterSelects tool through the selected browser session. Chat mode applies the same policy and approval mode as the in-app AI.',
    inputSchema: objectSchema({
      args: { type: 'object', additionalProperties: true, default: {} },
      confirm: { type: 'boolean', default: false },
      dryRun: { type: 'boolean', default: false },
      idempotencyKey: { type: 'string' },
      name: { type: 'string' },
      sessionId: { type: 'string' },
      surface: { type: 'string', enum: ['chat', 'devBridge'], default: defaultSurface },
      timeoutMs: { type: 'number', minimum: 1000, maximum: 300000 },
    }, ['name']),
  },
  {
    name: 'bridge_get_history',
    description: 'Read merged project chat history, in-app AI audit records, and external bridge traces for a browser session.',
    inputSchema: objectSchema({
      includeMessages: { type: 'boolean', default: true },
      limit: { type: 'number', minimum: 1, maximum: 2000, default: 500 },
      sessionId: { type: 'string' },
      surface: { type: 'string', enum: ['chat', 'devBridge'] },
      tool: { type: 'string' },
    }),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_get_tool_result',
    description: 'Get the complete stored result and metadata for a bridge, chat, or in-app audit call id.',
    inputSchema: objectSchema({
      callId: { type: 'string' },
      sessionId: { type: 'string' },
    }, ['callId']),
    annotations: readOnlyAnnotations(),
  },
  {
    name: 'bridge_replay_tool_call',
    description: 'Replay a stored MasterSelects tool call through the real dispatcher, optionally with replacement arguments.',
    inputSchema: objectSchema({
      argumentsOverride: { type: 'object', additionalProperties: true },
      callId: { type: 'string' },
      confirm: { type: 'boolean', default: false },
      dryRun: { type: 'boolean', default: false },
      idempotencyKey: { type: 'string' },
      sessionId: { type: 'string' },
      surface: { type: 'string', enum: ['chat', 'devBridge'] },
      timeoutMs: { type: 'number', minimum: 1000, maximum: 300000 },
    }, ['callId']),
  },
];

const server = new Server(
  { name: 'masterselects', version: '1.0.0' },
  { capabilities: { tools: { listChanged: true } } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  try {
    cachedRemoteTools = await loadRemoteTools(defaultSurface, selectedSessionId);
  } catch (error) {
    cachedRemoteTools = [];
    console.error(`[masterselects-mcp] Live tools unavailable: ${formatError(error)}`);
  }

  return {
    tools: [
      ...CONTROL_TOOLS,
      ...cachedRemoteTools.map(toMcpTool),
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: rawArguments } = request.params;
  const args = isRecord(rawArguments) ? rawArguments : {};

  try {
    const result = isControlTool(name)
      ? await callControlTool(name, args)
      : await callRemoteTool(name, args);
    return toMcpResult(result);
  } catch (error) {
    return toMcpResult({
      success: false,
      error: formatError(error),
    }, true);
  }
});

await server.connect(new StdioServerTransport());
console.error(`[masterselects-mcp] Connected to ${baseUrl}; default surface=${defaultSurface}`);

async function callControlTool(name, args) {
  switch (name) {
    case 'bridge_list_sessions':
      return bridgeFetch('/api/agent-control/sessions');
    case 'bridge_select_session': {
      const sessionId = requiredString(args.sessionId, 'sessionId');
      const response = await bridgeFetch('/api/agent-control/sessions');
      const sessions = response?.data?.sessions;
      if (!Array.isArray(sessions) || !sessions.some((session) => session?.sessionId === sessionId)) {
        throw new Error(`Unknown or stale MasterSelects session: ${sessionId}`);
      }
      selectedSessionId = sessionId;
      cachedRemoteTools = await loadRemoteTools(defaultSurface, selectedSessionId);
      return { success: true, data: { selectedSessionId, toolCount: cachedRemoteTools.length } };
    }
    case 'bridge_list_tools':
      return bridgeFetch(toQuery('/api/agent-control/tools', {
        sessionId: optionalString(args.sessionId) || selectedSessionId,
        surface: normalizeSurface(args.surface),
      }));
    case 'bridge_get_tool_schema':
      return bridgeFetch(toQuery(`/api/agent-control/tools/${encodeURIComponent(requiredString(args.name, 'name'))}`, {
        sessionId: optionalString(args.sessionId) || selectedSessionId,
        surface: normalizeSurface(args.surface),
      }));
    case 'bridge_call_tool':
      return bridgeFetch('/api/agent-control/call', {
        method: 'POST',
        body: {
          args: isRecord(args.args) ? args.args : {},
          confirm: args.confirm === true,
          dryRun: args.dryRun === true,
          idempotencyKey: optionalString(args.idempotencyKey) || createIdempotencyKey(),
          sessionId: optionalString(args.sessionId) || selectedSessionId,
          surface: normalizeSurface(args.surface),
          timeoutMs: normalizeTimeout(args.timeoutMs, defaultTimeoutMs),
          tool: requiredString(args.name, 'name'),
        },
      });
    case 'bridge_get_history':
      return bridgeFetch(toQuery('/api/agent-control/history', {
        includeMessages: args.includeMessages === false ? 'false' : 'true',
        limit: normalizeLimit(args.limit),
        sessionId: optionalString(args.sessionId) || selectedSessionId,
        surface: optionalSurface(args.surface),
        tool: optionalString(args.tool),
      }));
    case 'bridge_get_tool_result':
      return bridgeFetch(toQuery(`/api/agent-control/calls/${encodeURIComponent(requiredString(args.callId, 'callId'))}`, {
        sessionId: optionalString(args.sessionId) || selectedSessionId,
      }));
    case 'bridge_replay_tool_call':
      return bridgeFetch('/api/agent-control/replay', {
        method: 'POST',
        body: {
          argumentsOverride: isRecord(args.argumentsOverride) ? args.argumentsOverride : undefined,
          callId: requiredString(args.callId, 'callId'),
          confirm: args.confirm === true,
          dryRun: args.dryRun === true,
          idempotencyKey: optionalString(args.idempotencyKey) || createIdempotencyKey(),
          sessionId: optionalString(args.sessionId) || selectedSessionId,
          surface: optionalSurface(args.surface),
          timeoutMs: normalizeTimeout(args.timeoutMs, defaultTimeoutMs),
        },
      });
    default:
      throw new Error(`Unknown bridge control tool: ${name}`);
  }
}

async function callRemoteTool(name, args) {
  if (!cachedRemoteTools.some((tool) => tool.definition?.function?.name === name)) {
    cachedRemoteTools = await loadRemoteTools(defaultSurface, selectedSessionId);
  }
  if (!cachedRemoteTools.some((tool) => tool.definition?.function?.name === name)) {
    throw new Error(`MasterSelects tool "${name}" is not available on the ${defaultSurface} surface.`);
  }

  const {
    confirm,
    dryRun,
    idempotencyKey,
    timeoutMs,
    ...toolArgs
  } = args;
  const resolvedTimeoutMs = normalizeTimeout(timeoutMs, defaultTimeoutMs);
  return bridgeFetch('/api/agent-control/call', {
    method: 'POST',
    timeoutMs: resolvedTimeoutMs,
    body: {
      args: toolArgs,
      confirm: confirm === true,
      dryRun: dryRun === true,
      idempotencyKey: optionalString(idempotencyKey) || createIdempotencyKey(),
      sessionId: selectedSessionId,
      surface: defaultSurface,
      timeoutMs: resolvedTimeoutMs,
      tool: name,
    },
  });
}

async function loadRemoteTools(surface, sessionId) {
  const response = await bridgeFetch(toQuery('/api/agent-control/tools', {
    sessionId,
    surface,
  }));
  const tools = response?.data?.tools;
  if (!Array.isArray(tools)) {
    throw new Error('MasterSelects bridge returned no live tool list.');
  }
  return tools;
}

function toMcpTool(descriptor) {
  const definition = descriptor.definition?.function;
  const policy = descriptor.policy || {};
  return {
    name: definition.name,
    description: definition.description,
    inputSchema: withExecutionControls(definition.parameters, policy),
    annotations: {
      readOnlyHint: policy.readOnly === true,
      destructiveHint: policy.riskLevel === 'high' || policy.requiresConfirmation === true,
      idempotentHint: policy.readOnly === true,
      openWorldHint: policy.localFileAccess === true || policy.sensitiveDataAccess === true,
    },
  };
}

function withExecutionControls(parameters, policy) {
  const schema = isRecord(parameters) ? parameters : objectSchema({});
  const properties = isRecord(schema.properties) ? schema.properties : {};
  return {
    ...schema,
    type: 'object',
    properties: {
      ...properties,
      confirm: {
        type: 'boolean',
        default: false,
        description: policy.requiresConfirmation === true
          ? 'Required to execute this tool because its policy requires confirmation.'
          : 'Explicitly confirm execution.',
      },
      dryRun: {
        type: 'boolean',
        default: false,
        description: 'Validate and preview the call without applying editor changes.',
      },
      idempotencyKey: {
        type: 'string',
        description: 'Optional stable key used to deduplicate retries.',
      },
      timeoutMs: {
        type: 'number',
        minimum: 1000,
        maximum: 300000,
      },
    },
  };
}

async function bridgeFetch(route, options = {}) {
  const token = readBridgeToken();
  const timeoutMs = normalizeTimeout(options.timeoutMs, defaultTimeoutMs);
  const response = await fetch(`${baseUrl}${route}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-MasterSelects-Bridge-Client': 'mcp',
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { success: false, error: text || `HTTP ${response.status}` };
  }
  if (!response.ok) {
    throw new Error(payload.error || `MasterSelects bridge returned HTTP ${response.status}.`);
  }
  return payload;
}

function readBridgeToken() {
  try {
    const token = fs.readFileSync(tokenPath, 'utf8').trim();
    if (!token) throw new Error('token file is empty');
    return token;
  } catch (error) {
    throw new Error(`Cannot read MasterSelects bridge token at ${tokenPath}: ${formatError(error)}`);
  }
}

function toMcpResult(payload, forceError = false) {
  const image = findDataImage(payload);
  const content = [{
    type: 'text',
    text: JSON.stringify(image ? redactDataImages(payload) : payload, null, 2),
  }];
  if (image) {
    content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
  }
  return {
    content,
    isError: forceError || payload?.success === false,
    structuredContent: isRecord(payload)
      ? redactDataImages(payload)
      : { value: redactDataImages(payload) },
  };
}

function findDataImage(value, depth = 0) {
  if (depth > 8) return null;
  if (typeof value === 'string') {
    const match = value.match(/^data:(image\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i);
    return match ? { mimeType: match[1], data: match[2].replace(/\s/g, '') } : null;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      const image = findDataImage(entry, depth + 1);
      if (image) return image;
    }
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) {
      const image = findDataImage(entry, depth + 1);
      if (image) return image;
    }
  }
  return null;
}

function redactDataImages(value) {
  if (typeof value === 'string') {
    return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value) ? '[image returned as MCP image content]' : value;
  }
  if (Array.isArray(value)) return value.map(redactDataImages);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, redactDataImages(entry)]));
  }
  return value;
}

function isControlTool(name) {
  return CONTROL_TOOLS.some((tool) => tool.name === name);
}

function objectSchema(properties, required = []) {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  };
}

function readOnlyAnnotations() {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  };
}

function normalizeSurface(value) {
  return value === 'chat' || value === 'devBridge' ? value : defaultSurface;
}

function optionalSurface(value) {
  return value === 'chat' || value === 'devBridge' ? value : undefined;
}

function normalizeLimit(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(1, Math.min(2000, Math.round(value)))
    : 500;
}

function normalizeTimeout(value, fallback) {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed)
    ? Math.max(1000, Math.min(300000, Math.round(parsed)))
    : fallback;
}

function requiredString(value, name) {
  const normalized = optionalString(value);
  if (!normalized) throw new Error(`Missing required argument: ${name}`);
  return normalized;
}

function optionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toQuery(route, values) {
  const url = new URL(route, baseUrl);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }
  return `${url.pathname}${url.search}`;
}

function createIdempotencyKey() {
  return `mcp-${crypto.randomUUID()}`;
}

function formatError(error) {
  return error instanceof Error ? error.message : String(error);
}
