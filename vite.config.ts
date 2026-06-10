import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/version'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import {
  allowedFileRoots,
  bridgeToken,
  createDevBridgePlugin,
} from './tools/devBridge/vitePlugin.ts'

const KIEAI_PROXY_BASE_URL = 'https://api.kie.ai';
const KIEAI_PROXY_UPLOAD_URL = 'https://kieai.redpandaai.co/api/file-stream-upload';
const KIEAI_PROXY_ALLOWED_ENDPOINTS = new Set([
  '/api/v1/chat/credit',
  '/api/v1/jobs/createTask',
  '/api/v1/jobs/recordInfo',
]);
const EVOLINK_PROXY_BASE_URL = 'https://api.evolink.ai';
const EVOLINK_PROXY_UPLOAD_URL = 'https://files-api.evolink.ai/api/v1/files/upload/stream';

function writeJsonResponse(res: ServerResponse, statusCode: number, payload: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(payload));
}

function getByoKieAiKey(req: IncomingMessage): string | null {
  const raw = req.headers['x-kieai-api-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function getByoEvolinkKey(req: IncomingMessage): string | null {
  const raw = req.headers['x-evolink-api-key'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function isSameOriginDevRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function readRequestBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });

    req.on('error', reject);
  });
}

function resolveAllowedKieAiProxyUrl(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return null;
  }

  try {
    const target = new URL(endpoint, KIEAI_PROXY_BASE_URL);
    const base = new URL(KIEAI_PROXY_BASE_URL);

    if (target.origin !== base.origin || !KIEAI_PROXY_ALLOWED_ENDPOINTS.has(target.pathname)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

function isAllowedEvolinkProxyPath(pathname: string): boolean {
  return pathname === '/v1/images/generations'
    || pathname === '/v1/credits'
    || /^\/v1\/tasks\/[^/]+$/.test(pathname);
}

function resolveAllowedEvolinkProxyUrl(endpoint: unknown): URL | null {
  if (typeof endpoint !== 'string' || !endpoint.trim()) {
    return null;
  }

  try {
    const target = new URL(endpoint, EVOLINK_PROXY_BASE_URL);
    const base = new URL(EVOLINK_PROXY_BASE_URL);

    if (target.origin !== base.origin || !isAllowedEvolinkProxyPath(target.pathname)) {
      return null;
    }

    return target;
  } catch {
    return null;
  }
}

function kieAiByoProxy(): Plugin {
  return {
    name: 'kieai-byo-proxy',
    configureServer(server) {
      server.middlewares.use('/api/kieai/byo/request', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST, OPTIONS');
          res.end('Method not allowed');
          return;
        }

        if (!isSameOriginDevRequest(req)) {
          writeJsonResponse(res, 403, { error: 'invalid_origin' });
          return;
        }

        const apiKey = getByoKieAiKey(req);
        if (!apiKey) {
          writeJsonResponse(res, 401, { error: 'missing_kieai_key' });
          return;
        }

        let body: { body?: unknown; endpoint?: unknown; method?: unknown };
        try {
          body = JSON.parse(await readRequestBody(req)) as typeof body;
        } catch (error) {
          writeJsonResponse(res, 400, {
            error: 'invalid_json',
            message: error instanceof Error ? error.message : 'Invalid JSON body',
          });
          return;
        }

        const target = resolveAllowedKieAiProxyUrl(body.endpoint);
        const method = body.method === 'POST' ? 'POST' : body.method === 'GET' ? 'GET' : null;
        if (!target || !method) {
          writeJsonResponse(res, 400, { error: 'invalid_kieai_proxy_request' });
          return;
        }

        try {
          const upstream = await fetch(target, {
            method,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: method === 'POST' && body.body !== undefined ? JSON.stringify(body.body) : undefined,
          });
          const responseBody = await upstream.arrayBuffer();

          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
          res.end(Buffer.from(responseBody));
        } catch (error) {
          writeJsonResponse(res, 502, {
            error: 'kieai_proxy_failed',
            message: error instanceof Error ? error.message : 'Failed to reach Kie.ai',
          });
        }
      });

      server.middlewares.use('/api/kieai/byo/upload', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST, OPTIONS');
          res.end('Method not allowed');
          return;
        }

        if (!isSameOriginDevRequest(req)) {
          writeJsonResponse(res, 403, { error: 'invalid_origin' });
          return;
        }

        const apiKey = getByoKieAiKey(req);
        const contentType = req.headers['content-type'];
        if (!apiKey || typeof contentType !== 'string') {
          writeJsonResponse(res, apiKey ? 400 : 401, {
            error: apiKey ? 'missing_content_type' : 'missing_kieai_key',
          });
          return;
        }

        try {
          const upstream = await fetch(KIEAI_PROXY_UPLOAD_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': contentType,
            },
            body: req,
            duplex: 'half',
          } as RequestInit & { duplex: 'half' });
          const responseBody = await upstream.arrayBuffer();

          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
          res.end(Buffer.from(responseBody));
        } catch (error) {
          writeJsonResponse(res, 502, {
            error: 'kieai_upload_proxy_failed',
            message: error instanceof Error ? error.message : 'Failed to upload to Kie.ai',
          });
        }
      });

      server.middlewares.use('/api/evolink/byo/request', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST, OPTIONS');
          res.end('Method not allowed');
          return;
        }

        if (!isSameOriginDevRequest(req)) {
          writeJsonResponse(res, 403, { error: 'invalid_origin' });
          return;
        }

        const apiKey = getByoEvolinkKey(req);
        if (!apiKey) {
          writeJsonResponse(res, 401, { error: 'missing_evolink_key' });
          return;
        }

        let body: { body?: unknown; endpoint?: unknown; method?: unknown };
        try {
          body = JSON.parse(await readRequestBody(req)) as typeof body;
        } catch (error) {
          writeJsonResponse(res, 400, {
            error: 'invalid_json',
            message: error instanceof Error ? error.message : 'Invalid JSON body',
          });
          return;
        }

        const target = resolveAllowedEvolinkProxyUrl(body.endpoint);
        const method = body.method === 'POST' ? 'POST' : body.method === 'GET' ? 'GET' : null;
        if (!target || !method) {
          writeJsonResponse(res, 400, { error: 'invalid_evolink_proxy_request' });
          return;
        }

        try {
          const upstream = await fetch(target, {
            method,
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: method === 'POST' && body.body !== undefined ? JSON.stringify(body.body) : undefined,
          });
          const responseBody = await upstream.arrayBuffer();

          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
          res.end(Buffer.from(responseBody));
        } catch (error) {
          writeJsonResponse(res, 502, {
            error: 'evolink_proxy_failed',
            message: error instanceof Error ? error.message : 'Failed to reach EvoLink',
          });
        }
      });

      server.middlewares.use('/api/evolink/byo/upload', async (req, res) => {
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }

        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Allow', 'POST, OPTIONS');
          res.end('Method not allowed');
          return;
        }

        if (!isSameOriginDevRequest(req)) {
          writeJsonResponse(res, 403, { error: 'invalid_origin' });
          return;
        }

        const apiKey = getByoEvolinkKey(req);
        const contentType = req.headers['content-type'];
        if (!apiKey || typeof contentType !== 'string') {
          writeJsonResponse(res, apiKey ? 400 : 401, {
            error: apiKey ? 'missing_content_type' : 'missing_evolink_key',
          });
          return;
        }

        try {
          const upstream = await fetch(EVOLINK_PROXY_UPLOAD_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': contentType,
            },
            body: req,
            duplex: 'half',
          } as RequestInit & { duplex: 'half' });
          const responseBody = await upstream.arrayBuffer();

          res.statusCode = upstream.status;
          res.setHeader('Content-Type', upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8');
          res.end(Buffer.from(responseBody));
        } catch (error) {
          writeJsonResponse(res, 502, {
            error: 'evolink_upload_proxy_failed',
            message: error instanceof Error ? error.message : 'Failed to upload to EvoLink',
          });
        }
      });
    },
  };
}

function splatTransformWebpWasmPathFix(): Plugin {
  return {
    name: 'splat-transform-webp-wasm-path-fix',
    enforce: 'pre',
    transform(code, id) {
      const normalizedId = id.replace(/\\/g, '/');
      if (!normalizedId.endsWith('/node_modules/@playcanvas/splat-transform/dist/index.mjs')) {
        return null;
      }

      return code.replace(
        /new URL\("webp\.wasm",\s*import\.meta\.url\)\.href/g,
        'new URL("../lib/webp.wasm", import.meta.url).href',
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve';
  const enableDevBridge = isDevServer && mode !== 'test';
  const hostedApiProxyTarget = 'http://127.0.0.1:8788';
  const hostedApiProxyRoutes = [
    '/api/me',
    '/api/auth',
    '/api/billing',
    '/api/stripe',
    '/api/ai/chat',
    '/api/ai/audio',
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
      kieAiByoProxy(),
      createDevBridgePlugin({ enableAiToolsBridge: enableDevBridge }),
      splatTransformWebpWasmPathFix(),
      // Replace __APP_VERSION__ in index.html during build
      {
        name: 'html-version-replace',
        transformIndexHtml(html) {
          return html.replace(/__APP_VERSION__/g, APP_VERSION);
        },
      },
    ],
    resolve: {
      alias: {
        module: path.resolve(__dirname, 'src/shims/nodeModule.ts'),
      },
    },
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
