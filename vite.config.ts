import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/version'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

// ── Dev Bridge Session Token ─────────────────────────────────────────────────
const bridgeToken = crypto.randomUUID();
const tokenFilePath = path.resolve(__dirname, '.ai-bridge-token');
const allowedFileRoots = buildAllowedFileRoots();

type AllowedPathKind = 'file' | 'directory';

type AllowedPathResult =
  | { allowed: true; resolved: string; stat: fs.Stats }
  | { allowed: false; statusCode: number; error: string };

function normalizeAllowedRoot(root: string): string | null {
  const trimmed = root.trim();
  if (!trimmed || !path.isAbsolute(trimmed)) {
    return null;
  }

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return null;
  }

  const resolved = path.resolve(trimmed);
  try {
    return fs.realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

function uniqueRoots(roots: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const root of roots) {
    const normalized = normalizeAllowedRoot(root);
    if (!normalized) {
      continue;
    }

    const key = process.platform === 'win32'
      ? normalized.toLowerCase()
      : normalized;

    if (!seen.has(key)) {
      seen.add(key);
      unique.push(normalized);
    }
  }

  return unique;
}

function parseExtraAllowedRoots(): string[] {
  const configured = process.env.MASTERSELECTS_ALLOWED_FILE_ROOTS;
  if (!configured) {
    return [];
  }

  return configured
    .split(path.delimiter)
    .map(entry => entry.trim())
    .filter(Boolean);
}

function buildAllowedFileRoots(): string[] {
  const home = os.homedir();
  const defaults = [
    __dirname,
    process.env.MASTERSELECTS_PROJECT_ROOT ?? '',
    os.tmpdir(),
    home ? path.join(home, 'Desktop') : '',
    home ? path.join(home, 'Documents') : '',
    home ? path.join(home, 'Downloads') : '',
    home ? path.join(home, 'Videos') : '',
    ...parseExtraAllowedRoots(),
  ];

  return uniqueRoots(defaults);
}

function isPathInsideRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateAllowedPath(rawPath: string, kind: AllowedPathKind): AllowedPathResult {
  const trimmed = rawPath.trim();
  if (!trimmed) {
    return { allowed: false, statusCode: 400, error: `Missing ${kind} path` };
  }

  if (!path.isAbsolute(trimmed)) {
    return { allowed: false, statusCode: 400, error: 'Path must be absolute' };
  }

  if (trimmed.startsWith('\\\\') || trimmed.startsWith('//')) {
    return { allowed: false, statusCode: 403, error: 'UNC paths are not allowed' };
  }

  const resolved = path.resolve(trimmed);
  let realPath: string;
  let stat: fs.Stats;

  try {
    realPath = fs.realpathSync.native(resolved);
    stat = fs.statSync(realPath);
  } catch {
    return {
      allowed: false,
      statusCode: 404,
      error: kind === 'file' ? 'File not found' : 'Directory not found',
    };
  }

  if (kind === 'file' && stat.isDirectory()) {
    return { allowed: false, statusCode: 404, error: 'File not found' };
  }

  if (kind === 'directory' && !stat.isDirectory()) {
    return { allowed: false, statusCode: 404, error: 'Directory not found' };
  }

  if (!allowedFileRoots.some(root => isPathInsideRoot(realPath, root))) {
    return { allowed: false, statusCode: 403, error: 'Path is outside allowed roots' };
  }

  return { allowed: true, resolved: realPath, stat };
}

/**
 * Derive the allowed origin from the request.
 * Only localhost / 127.0.0.1 origins are accepted.
 */
function getLocalhostOrigin(req: IncomingMessage): string | null {
  const origin = req.headers.origin;
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return origin;
    }
  } catch { /* invalid origin */ }
  return null;
}

/**
 * Set CORS headers for sensitive routes.
 * Replaces wildcard with the requesting localhost origin (or omits the header).
 */
function setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
  const origin = getLocalhostOrigin(req);
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  // If no valid localhost origin, omit Access-Control-Allow-Origin entirely
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

/**
 * Validate a bridge request: check bearer token and origin.
 * Returns true if valid, false if the response was already sent with an error.
 */
function validateBridgeRequest(req: IncomingMessage, res: ServerResponse): boolean {
  // Handle preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.statusCode = 204;
    res.end();
    return false; // response sent, but it's a valid preflight
  }

  setCorsHeaders(req, res);

  // Check Authorization header
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Missing or invalid Authorization header' }));
    return false;
  }

  const token = authHeader.slice(7);
  if (token !== bridgeToken) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Invalid bridge token' }));
    return false;
  }

  // Check Origin header if present — must be localhost
  const origin = req.headers.origin;
  if (origin) {
    const localhostOrigin = getLocalhostOrigin(req);
    if (!localhostOrigin) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Non-localhost origin rejected' }));
      return false;
    }
  }

  return true;
}

// Local File Server - serves local files for AI-driven import
function localFileServer(): Plugin {
  return {
    name: 'local-file-server',
    configureServer(server) {
      // Serve a local file by absolute path
      server.middlewares.use('/api/local-file', (req, res) => {
        // Auth gate
        if (!validateBridgeRequest(req, res)) return;

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const filePath = url.searchParams.get('path');
        if (!filePath) {
          res.statusCode = 400;
          res.end('Missing path parameter');
          return;
        }

        const validation = validateAllowedPath(filePath, 'file');
        if (!validation.allowed) {
          res.statusCode = validation.statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: validation.error }));
          return;
        }

        const { resolved, stat } = validation;
        const ext = path.extname(resolved).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
          '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
          '.m4a': 'audio/mp4',
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp', '.svg': 'image/svg+xml',
          '.obj': 'model/obj', '.gltf': 'model/gltf+json', '.glb': 'model/gltf-binary', '.fbx': 'application/octet-stream',
          '.ply': 'application/octet-stream', '.splat': 'application/octet-stream', '.ksplat': 'application/octet-stream',
          '.spz': 'application/octet-stream', '.sog': 'application/octet-stream', '.lcc': 'application/octet-stream',
          '.zip': 'application/zip',
        };
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');

        // Support range requests for video seeking
        const range = req.headers.range;
        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          res.setHeader('Accept-Ranges', 'bytes');
          fs.createReadStream(resolved, { start, end }).pipe(res);
        } else {
          res.setHeader('Content-Length', stat.size);
          res.setHeader('Accept-Ranges', 'bytes');
          fs.createReadStream(resolved).pipe(res);
        }
      });

      // List media files in a directory
      server.middlewares.use('/api/local-files', (req, res) => {
        // Auth gate
        if (!validateBridgeRequest(req, res)) return;

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }
        const url = new URL(req.url!, `http://${req.headers.host}`);
        const dirPath = url.searchParams.get('dir');
        const extFilter = url.searchParams.get('ext')?.split(',') ||
          ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.mp3', '.wav', '.aac', '.ogg', '.m4a', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.obj', '.gltf', '.glb', '.fbx', '.ply', '.splat', '.ksplat', '.spz', '.sog', '.lcc', '.zip'];

        if (!dirPath) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Missing dir parameter' }));
          return;
        }

        const validation = validateAllowedPath(dirPath, 'directory');
        if (!validation.allowed) {
          res.statusCode = validation.statusCode;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: validation.error }));
          return;
        }

        try {
          const resolved = validation.resolved;
          const entries = fs.readdirSync(resolved);
          const files = entries
            .filter(f => extFilter.some(ext => f.toLowerCase().endsWith(ext)))
            .flatMap(f => {
              const fullPath = path.join(resolved, f);
              let realPath: string;
              let stat: fs.Stats;

              try {
                realPath = fs.realpathSync.native(fullPath);
                stat = fs.statSync(realPath);
              } catch {
                return [];
              }

              if (!stat.isFile()) {
                return [];
              }

              if (!allowedFileRoots.some(root => isPathInsideRoot(realPath, root))) {
                return [];
              }

              return {
                name: f,
                path: realPath.replace(/\\/g, '/'),
                size: stat.size,
                modified: stat.mtime.toISOString(),
              };
            });
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ files }));
        } catch {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Failed to list directory' }));
        }
      });
    },
  };
}

// Browser Log Bridge - allows AI agents to read browser console logs
function browserLogBridge(): Plugin {
  const logFile = path.resolve(__dirname, '.browser-logs.json');

  return {
    name: 'browser-log-bridge',
    configureServer(server) {
      // Handle log sync from browser
      server.middlewares.use('/api/logs', (req, res) => {
        // Auth gate
        if (!validateBridgeRequest(req, res)) return;

        if (req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => body += chunk.toString());
          req.on('end', () => {
            try {
              fs.writeFileSync(logFile, body);
              res.statusCode = 200;
              res.end('ok');
            } catch {
              res.statusCode = 500;
              res.end('write error');
            }
          });
        } else if (req.method === 'GET') {
          // AI agent reads logs via this endpoint
          try {
            const logs = fs.existsSync(logFile)
              ? fs.readFileSync(logFile, 'utf-8')
              : '{"totalLogs":0,"errorCount":0,"warnCount":0,"recentErrors":[],"activeModules":[]}';
            res.setHeader('Content-Type', 'application/json');
            res.end(logs);
          } catch {
            res.statusCode = 500;
            res.end('{}');
          }
        } else {
          res.statusCode = 405;
          res.end('Method not allowed');
        }
      });
    }
  };
}

// In-memory blob store — serves uploaded binary data via HTTP URL
// Used by GaussianSplatSceneRenderer to serve avatar ZIPs (the renderer module can't fetch blob: URLs)
function blobStoreServer(): Plugin {
  const blobs = new Map<string, Buffer>();
  return {
    name: 'blob-store-server',
    configureServer(server) {
      // POST /api/blob-store → store blob, return ID
      server.middlewares.use('/api/blob-store', (req, res) => {
        setCorsHeaders(req, res);
        if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(); return; }

        if (req.method === 'POST') {
          // No auth required — CORS restricts to localhost, and data is only served back via GET
          const chunks: Buffer[] = [];
          req.on('data', (chunk: Buffer) => chunks.push(chunk));
          req.on('end', () => {
            const id = crypto.randomUUID();
            blobs.set(id, Buffer.concat(chunks));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ id, url: `/api/blob-store/${id}/avatar.zip` }));
            // Auto-cleanup after 10 minutes
            setTimeout(() => blobs.delete(id), 10 * 60 * 1000);
          });
          return;
        }

        // GET /api/blob-store/:id/avatar.zip → serve blob
        if (req.method === 'GET') {
          const urlPath = req.url?.replace(/^\//, '').split('?')[0] || '';
          const id = urlPath.split('/')[0]; // Extract UUID from path
          const data = id ? blobs.get(id) : undefined;
          if (!data) { res.statusCode = 404; res.end('Not found'); return; }
          res.setHeader('Content-Type', 'application/zip');
          res.setHeader('Content-Length', data.length);
          res.end(data);
          return;
        }

        res.statusCode = 405;
        res.end('Method not allowed');
      });
    },
  };
}

// AI Tools Bridge - lets external agents (Claude CLI) execute aiTools via HTTP
// Flow: POST /api/ai-tools → Vite server → HMR → browser → aiTools.execute() → HMR → HTTP response
function aiToolsBridge(): Plugin {
  const pendingRequests = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const pendingDebugRequests = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const pendingDebugActionRequests = new Map<string, { resolve: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
  const clients = new Map<string, { tabId: string; visibilityState: string; hasFocus: boolean; lastSeenAt: number }>();
  let requestCounter = 0;

  const pruneClients = () => {
    const now = Date.now();
    for (const [tabId, client] of clients) {
      if (now - client.lastSeenAt > 120000) {
        clients.delete(tabId);
      }
    }
  };

  const pickTargetTabId = (): string | null => {
    pruneClients();
    const liveClients = [...clients.values()];
    if (liveClients.length === 0) {
      return null;
    }

    liveClients.sort((a, b) => b.lastSeenAt - a.lastSeenAt);

    const focusedVisible = liveClients.find((client) => client.visibilityState === 'visible' && client.hasFocus);
    if (focusedVisible) return focusedVisible.tabId;

    const visible = liveClients.find((client) => client.visibilityState === 'visible');
    if (visible) return visible.tabId;

    return liveClients[0].tabId;
  };

  return {
    name: 'ai-tools-bridge',
    configureServer(server) {
      // Write token file and print banner on server start
      try {
        fs.writeFileSync(tokenFilePath, bridgeToken, 'utf-8');
      } catch { /* best effort */ }

      console.log('\n┌─────────────────────────────────────────────────────────┐');
      console.log('│  AI Bridge Token (required for /api/* endpoints):       │');
      console.log(`│  ${bridgeToken}  │`);
      console.log('│  Token written to .ai-bridge-token                      │');
      console.log('│  Use: Authorization: Bearer <token>                     │');
      console.log('└─────────────────────────────────────────────────────────┘\n');
      console.log(`[security] Allowed dev file roots: ${allowedFileRoots.join(', ')}`);

      // Listen for results coming back from the browser via HMR
      server.hot.on('ai-tools:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingRequests.delete(data.requestId);
          pending.resolve(data.result);
        }
      });

      server.hot.on('debug-state:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingDebugRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDebugRequests.delete(data.requestId);
          pending.resolve(data.result);
        }
      });

      server.hot.on('debug-action:result', (data: { requestId: string; result: unknown }) => {
        const pending = pendingDebugActionRequests.get(data.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          pendingDebugActionRequests.delete(data.requestId);
          pending.resolve(data.result);
        }
      });

      server.hot.on('ai-tools:presence', (data: { tabId: string; visibilityState?: string; hasFocus?: boolean }) => {
        if (!data?.tabId) return;
        clients.set(data.tabId, {
          tabId: data.tabId,
          visibilityState: data.visibilityState ?? 'hidden',
          hasFocus: Boolean(data.hasFocus),
          lastSeenAt: Date.now(),
        });
      });

      server.middlewares.use('/api/ai-tools', (req, res) => {
        // GET status endpoint is unauthenticated (shows readiness only)
        if (req.method === 'GET') {
          setCorsHeaders(req, res);
          res.setHeader('Content-Type', 'application/json');
          pruneClients();
          res.end(JSON.stringify({ status: 'ready', pending: pendingRequests.size, clients: clients.size }));
          return;
        }

        // All other methods require auth
        if (!validateBridgeRequest(req, res)) return;

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => body += chunk.toString());
        req.on('end', () => {
          try {
            const { tool, args = {} } = JSON.parse(body);
            if (!tool) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Missing "tool" field' }));
              return;
            }

            const requestId = `r${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`;
            const targetTabId = pickTargetTabId();

            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingRequests.delete(requestId);
                resolve({ success: false, error: 'Timeout: no browser tab responded within 30s' });
              }, 30000);

              pendingRequests.set(requestId, { resolve, timer });
              server.hot.send('ai-tools:execute', { requestId, tool, args, targetTabId });
            });

            resultPromise.then((result) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            });
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
          }
        });
      });

      const handleDebugStateRequest = (req: IncomingMessage, res: ServerResponse, defaultScope: string) => {
        if (!validateBridgeRequest(req, res)) return;

        if (req.method !== 'GET') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const targetTabId = pickTargetTabId();
        if (!targetTabId) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }));
          return;
        }

        const url = new URL(req.url!, `http://${req.headers.host}`);
        const scope = url.searchParams.get('scope') || defaultScope;
        const requestId = `debug-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`;

        const resultPromise = new Promise((resolve) => {
          const timer = setTimeout(() => {
            pendingDebugRequests.delete(requestId);
            resolve({ success: false, error: 'Timeout: no browser tab responded within 30s' });
          }, 30000);

          pendingDebugRequests.set(requestId, { resolve, timer });
          server.hot.send('debug-state:request', { requestId, scope, targetTabId });
        });

        resultPromise.then((result) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(result));
        });
      };

      server.middlewares.use('/api/debug/state', (req, res) => {
        handleDebugStateRequest(req, res, 'all');
      });

      server.middlewares.use('/api/debug/preview-state', (req, res) => {
        handleDebugStateRequest(req, res, 'preview');
      });

      server.middlewares.use('/api/debug/slot-state', (req, res) => {
        handleDebugStateRequest(req, res, 'slots');
      });

      server.middlewares.use('/api/debug/action', (req, res) => {
        if (!validateBridgeRequest(req, res)) return;

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method not allowed');
          return;
        }

        const targetTabId = pickTargetTabId();
        if (!targetTabId) {
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'No browser tab connected to the dev bridge' }));
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => body += chunk.toString());
        req.on('end', () => {
          try {
            const { action, args = {} } = JSON.parse(body);
            if (!action) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Missing "action" field' }));
              return;
            }

            const requestId = `debug-action-${++requestCounter}-${crypto.randomUUID().slice(0, 8)}`;
            const resultPromise = new Promise((resolve) => {
              const timer = setTimeout(() => {
                pendingDebugActionRequests.delete(requestId);
                resolve({ success: false, error: 'Timeout: no browser tab responded within 30s' });
              }, 30000);

              pendingDebugActionRequests.set(requestId, { resolve, timer });
              server.hot.send('debug-action:request', { requestId, action, args, targetTabId });
            });

            resultPromise.then((result) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(result));
            });
          } catch {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: 'Invalid JSON body' }));
          }
        });
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  const hostedApiProxyTarget = 'http://127.0.0.1:8788';
  const hostedApiProxyRoutes = [
    '/api/me',
    '/api/auth',
    '/api/billing',
    '/api/stripe',
    '/api/ai/chat',
    '/api/ai/video',
    '/api/visits',
  ];
  const hostedApiProxy = Object.fromEntries(
    hostedApiProxyRoutes.map((route) => [
      route,
      {
        changeOrigin: false,
        target: hostedApiProxyTarget,
      },
    ]),
  );

  return {
    plugins: [
      react(),
      localFileServer(),
      blobStoreServer(),
      browserLogBridge(),
      aiToolsBridge(),
      // Replace __APP_VERSION__ in index.html during build
      {
        name: 'html-version-replace',
        transformIndexHtml(html) {
          return html.replace(/__APP_VERSION__/g, APP_VERSION);
        },
      },
    ],
    define: {
      __APP_VERSION__: JSON.stringify(APP_VERSION),
      // Show changelog in the app by default; tests override this separately.
      __SHOW_CHANGELOG__: true,
      __DEV_BRIDGE_TOKEN__: JSON.stringify(isDevServer ? bridgeToken : ''),
      __DEV_ALLOWED_FILE_ROOTS__: JSON.stringify(isDevServer ? allowedFileRoots : []),
    },
    server: {
      allowedHosts: ['localhost', '.localhost', '127.0.0.1'],
      headers: {
        // Required for SharedArrayBuffer (FFmpeg multi-threaded, cross-tab sync)
        // Using 'credentialless' instead of 'require-corp' to allow CDN resources
        // (FFmpeg WASM from unpkg, transformers.js from HuggingFace)
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
      proxy: hostedApiProxy,
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        onwarn(warning, warn) {
          if (warning.message.includes('dynamic import will not move module into another chunk')) {
            return;
          }
          warn(warning);
        },
        output: {
          manualChunks: {
            // Force heavy libs into separate chunks (loaded on demand)
            'mp4box': ['mp4box'],
          },
        },
      },
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
      // Exclude transformers.js and onnxruntime from pre-bundling
      exclude: ['@huggingface/transformers', 'onnxruntime-web'],
    },
  };
})
