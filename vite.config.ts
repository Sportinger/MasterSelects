import { defineConfig, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/version'
import { gzipSync } from 'node:zlib'
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'path'
import {
  allowedFileRoots,
  bridgeToken,
  createDevBridgePlugin,
} from './tools/devBridge/vitePlugin.ts'

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

// LAN device testing (iPad/phone on the same Wi-Fi). Opt-in via
// MASTERSELECTS_LAN_HOST=<lan-ip>; plain `npm run dev`/`dev:full` stay
// localhost-only. WebGPU, WebCodecs and SharedArrayBuffer all require a
// secure context, so LAN mode is HTTPS-only: without the mkcert pair in
// .certs/ the device would load a crippled app, and we fail loudly instead.
const LAN_CERT_FILE = 'lan-cert.pem';
const LAN_KEY_FILE = 'lan-key.pem';

type LanServerConfig = {
  allowedHost: string;
  https: { cert: Buffer; key: Buffer };
};

// Deliberately independent of LAN mode: a device cannot complete a TLS
// handshake before it trusts the CA, so the bootstrap download has to be
// reachable over plain `vite --host` too.
function resolveDevRootCaPath(): string | null {
  const rootCaPath = path.resolve(__dirname, '.certs', 'rootCA.pem');
  return existsSync(rootCaPath) ? rootCaPath : null;
}

function resolveLanServerConfig(): LanServerConfig | null {
  const lanHost = process.env.MASTERSELECTS_LAN_HOST?.trim();
  if (!lanHost) {
    return null;
  }

  const certDirectory = path.resolve(__dirname, '.certs');
  const certPath = path.join(certDirectory, LAN_CERT_FILE);
  const keyPath = path.join(certDirectory, LAN_KEY_FILE);

  if (!existsSync(certPath) || !existsSync(keyPath)) {
    throw new Error(
      `MASTERSELECTS_LAN_HOST=${lanHost} needs a TLS pair at .certs/${LAN_CERT_FILE} and .certs/${LAN_KEY_FILE}. `
      + `Generate it with: mkcert -cert-file .certs/${LAN_CERT_FILE} -key-file .certs/${LAN_KEY_FILE} ${lanHost} localhost 127.0.0.1 ::1`,
    );
  }

  return {
    allowedHost: lanHost,
    https: { cert: readFileSync(certPath), key: readFileSync(keyPath) },
  };
}

// Chicken-and-egg: the device must fetch the root CA before it trusts the
// LAN certificate, so this route is reachable through Safari's one-time
// "visit anyway" warning. Serves the public CA certificate only - the
// private keys next to it in .certs/ are never exposed.
function lanRootCaPlugin(rootCaPath: string): Plugin {
  return {
    name: 'lan-root-ca',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/dev-root-ca.pem', (_req, res) => {
        // iOS only offers the profile-install flow for this MIME type; as a
        // download (attachment / x-pem-file) the file just lands in Files
        // and can never become a trusted root.
        res.setHeader('Content-Type', 'application/x-x509-ca-cert');
        res.end(readFileSync(rootCaPath));
      });
    },
  };
}

function devHostedMediaDownloadPlugin(apiTarget: string): Plugin {
  return {
    name: 'dev-hosted-media-download',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const requestUrl = new URL(request.url ?? '/', 'http://localhost');
        const taskId = requestUrl.searchParams.get('taskId')?.trim();
        if (
          requestUrl.pathname !== '/api/ai/video'
          || requestUrl.searchParams.get('download') !== '1'
          || !taskId
          || (request.method !== 'GET' && request.method !== 'HEAD')
        ) {
          next();
          return;
        }

        try {
          const statusUrl = new URL('/api/ai/video', apiTarget);
          statusUrl.searchParams.set('taskId', taskId);
          const statusResponse = await fetch(statusUrl, {
            headers: {
              Accept: 'application/json',
              ...(request.headers.cookie ? { Cookie: request.headers.cookie } : {}),
            },
          });
          const statusPayload = await statusResponse.json() as {
            data?: { imageUrl?: unknown; videoUrl?: unknown };
          };
          const rawMediaUrl = statusPayload.data?.videoUrl ?? statusPayload.data?.imageUrl;
          if (!statusResponse.ok || typeof rawMediaUrl !== 'string') {
            response.statusCode = statusResponse.ok ? 409 : statusResponse.status;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify(statusPayload));
            return;
          }

          const mediaUrl = new URL(rawMediaUrl);
          if (mediaUrl.protocol !== 'https:' && mediaUrl.protocol !== 'http:') {
            throw new Error('Hosted media result used an unsupported URL protocol.');
          }
          const mediaResponse = await fetch(mediaUrl, {
            headers: {
              ...(request.headers.range ? { Range: request.headers.range } : {}),
              ...(request.headers['user-agent'] ? { 'User-Agent': request.headers['user-agent'] } : {}),
            },
            method: request.method,
            signal: AbortSignal.timeout(60_000),
          });
          if (!mediaResponse.ok || (request.method !== 'HEAD' && !mediaResponse.body)) {
            response.statusCode = 502;
            response.setHeader('Content-Type', 'application/json; charset=utf-8');
            response.end(JSON.stringify({ error: 'Failed to download hosted AI result from the provider.' }));
            return;
          }

          response.statusCode = mediaResponse.status;
          response.statusMessage = mediaResponse.statusText;
          response.setHeader('Cache-Control', 'private, no-store');
          response.setHeader('X-Content-Type-Options', 'nosniff');
          for (const header of ['accept-ranges', 'content-length', 'content-range', 'content-type', 'etag', 'last-modified']) {
            const value = mediaResponse.headers.get(header);
            if (value) response.setHeader(header, value);
          }
          if (request.method === 'HEAD') {
            response.end();
            return;
          }

          for await (const chunk of mediaResponse.body!) {
            if (!response.write(Buffer.from(chunk))) {
              await new Promise<void>((resolve) => response.once('drain', resolve));
            }
          }
          response.end();
        } catch (error) {
          if (response.headersSent) {
            response.destroy(error instanceof Error ? error : undefined);
            return;
          }
          response.statusCode = 502;
          response.setHeader('Content-Type', 'application/json; charset=utf-8');
          response.end(JSON.stringify({
            error: error instanceof Error ? error.message : 'Hosted media download failed.',
          }));
        }
      });
    },
  };
}

const SAM2_ORT_WASM_GZIP_PLACEHOLDER = '__SAM2_ORT_WASM_GZIP_URL__';
const CLOUDFLARE_PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const FFMPEG_CORE_DIRECTORY = path.resolve(__dirname, 'node_modules', '@ffmpeg', 'core', 'dist', 'umd');

function ffmpegCoreAssets(): Plugin {
  const coreJsPath = path.join(FFMPEG_CORE_DIRECTORY, 'ffmpeg-core.js');
  const coreWasmPath = path.join(FFMPEG_CORE_DIRECTORY, 'ffmpeg-core.wasm');
  let compressedWasm: Buffer | null = null;
  const getCompressedWasm = () => {
    compressedWasm ??= gzipSync(readFileSync(coreWasmPath), { level: 9 });
    return compressedWasm;
  };

  return {
    name: 'ffmpeg-core-assets',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url === '/ffmpeg/ffmpeg-core.js') {
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          response.end(readFileSync(coreJsPath));
          return;
        }
        if (request.url === '/ffmpeg/ffmpeg-core.wasm.gz') {
          response.setHeader('Content-Type', 'application/gzip');
          response.end(getCompressedWasm());
          return;
        }
        next();
      });
    },
    closeBundle() {
      const outputDirectory = path.resolve(__dirname, 'dist', 'ffmpeg');
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(path.join(outputDirectory, 'ffmpeg-core.js'), readFileSync(coreJsPath));
      writeFileSync(path.join(outputDirectory, 'ffmpeg-core.wasm.gz'), getCompressedWasm());
    },
  };
}

function compressOversizedSam2OrtWasm(): Plugin {
  return {
    name: 'compress-oversized-sam2-ort-wasm',
    apply: 'build',
    closeBundle() {
      const assetsDirectory = path.resolve(__dirname, 'dist/assets');
      const oversizedWasmFiles = readdirSync(assetsDirectory).filter((fileName) => {
        if (!/^ort-wasm-simd-threaded\.jsep-.*\.wasm$/.test(fileName)) {
          return false;
        }

        return readFileSync(path.join(assetsDirectory, fileName)).byteLength > CLOUDFLARE_PAGES_MAX_ASSET_BYTES;
      });

      if (oversizedWasmFiles.length === 0) {
        return;
      }
      if (oversizedWasmFiles.length !== 1) {
        throw new Error(`Expected one oversized SAM2 ORT WASM asset, found ${oversizedWasmFiles.length}.`);
      }

      const wasmFileName = oversizedWasmFiles[0];
      const wasmPath = path.join(assetsDirectory, wasmFileName);
      const gzipFileName = `${wasmFileName}.gz`;
      const gzipBytes = gzipSync(readFileSync(wasmPath), { level: 9 });
      if (gzipBytes.byteLength > CLOUDFLARE_PAGES_MAX_ASSET_BYTES) {
        throw new Error(`Compressed SAM2 ORT WASM asset is still too large: ${gzipBytes.byteLength} bytes.`);
      }

      const workerFiles = readdirSync(assetsDirectory).filter((fileName) => fileName.endsWith('.js'));
      const workerMatches = workerFiles.filter((fileName) =>
        readFileSync(path.join(assetsDirectory, fileName), 'utf8').includes(SAM2_ORT_WASM_GZIP_PLACEHOLDER),
      );
      if (workerMatches.length !== 1) {
        throw new Error(`Expected one SAM2 worker placeholder, found ${workerMatches.length}.`);
      }

      const workerPath = path.join(assetsDirectory, workerMatches[0]);
      const workerSource = readFileSync(workerPath, 'utf8').replaceAll(
        SAM2_ORT_WASM_GZIP_PLACEHOLDER,
        `/assets/${gzipFileName}`,
      );
      writeFileSync(workerPath, workerSource);
      writeFileSync(path.join(assetsDirectory, gzipFileName), gzipBytes);
      unlinkSync(wasmPath);
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve';
  const enableDevBridge = isDevServer && mode !== 'test';
  const freezeE2eSourceSnapshot = process.env.MASTERSELECTS_E2E_FREEZE_SOURCE === '1';
  const directCodexToken = process.env.MASTERSELECTS_DIRECT_CODEX_TOKEN?.trim();
  const devChatProxyOrigin = process.env.MASTERSELECTS_DEV_CHAT_PROXY_ORIGIN?.trim();
  const hostedApiProxyTarget = 'http://127.0.0.1:8788';
  const hostedApiProxyRoutes = [
    '/api/me',
    '/api/auth',
    '/api/billing',
    '/api/credits',
    '/api/support',
    '/api/legal',
    '/api/stripe',
    '/api/ai/chat',
    '/api/ai/audio',
    '/api/ai/video',
    '/api/media',
    '/api/kernel',
    '/api/analytics',
    '/api/visits',
    '/api/admin',
  ];
  const hostedApiProxy: Record<string, ProxyOptions> = {};
  if (devChatProxyOrigin) {
    const target = new URL(devChatProxyOrigin);
    if (target.protocol !== 'https:') {
      throw new Error('MASTERSELECTS_DEV_CHAT_PROXY_ORIGIN must use HTTPS.');
    }
    hostedApiProxy['/api/support/chat'] = {
      changeOrigin: true,
      configure(proxy) {
        proxy.on('proxyReq', (proxyRequest) => {
          // The hosted chat is deliberately anonymous. Never forward a local
          // login session or an agent credential across this dev-only hop.
          proxyRequest.removeHeader('authorization');
          proxyRequest.removeHeader('cookie');
          proxyRequest.removeHeader('referer');
          proxyRequest.setHeader('origin', target.origin);
        });
      },
      target: target.origin,
    };
  }
  Object.assign(hostedApiProxy, Object.fromEntries(
    hostedApiProxyRoutes.map((route) => [
      route,
      {
        changeOrigin: false,
        target: hostedApiProxyTarget,
      },
    ]),
  ));
  hostedApiProxy['/api/stream'] = {
    changeOrigin: false,
    target: hostedApiProxyTarget,
    ws: true,
  };
  if (directCodexToken) {
    hostedApiProxy['/api/direct-codex/ws'] = {
      changeOrigin: false,
      configure(proxy) {
        proxy.on('proxyReqWs', (proxyRequest) => {
          // Codex app-server intentionally rejects browser Origin headers. The
          // public side remains same-origin with Vite; strip Origin only on the
          // authenticated localhost hop to the isolated app-server.
          proxyRequest.removeHeader('origin');
        });
      },
      headers: { Authorization: `Bearer ${directCodexToken}` },
      rewrite: () => '/',
      target: 'ws://127.0.0.1:4500',
      ws: true,
    };
  }
  const lanServer = isDevServer ? resolveLanServerConfig() : null;
  const devRootCaPath = isDevServer ? resolveDevRootCaPath() : null;

  return {
    plugins: [
      react(),
      devHostedMediaDownloadPlugin(hostedApiProxyTarget),
      createDevBridgePlugin({ enableAiToolsBridge: enableDevBridge }),
      splatTransformWebpWasmPathFix(),
      ffmpegCoreAssets(),
      compressOversizedSam2OrtWasm(),
      ...(devRootCaPath ? [lanRootCaPlugin(devRootCaPath)] : []),
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
      __APP_BUILD_ID__: JSON.stringify(isDevServer ? 'development' : new Date().toISOString()),
      __DEV_BRIDGE_TOKEN__: JSON.stringify(isDevServer ? bridgeToken : ''),
      __DEV_ALLOWED_FILE_ROOTS__: JSON.stringify(isDevServer ? allowedFileRoots : []),
    },
    server: {
      // LAN mode binds every interface and serves TLS so devices on the
      // same Wi-Fi get a secure context. Vite derives the HMR websocket
      // from location when server.hmr is unset, which keeps both
      // https://localhost:5173 and https://<lan-ip>:5173 wired to the
      // dev bridge on the same port.
      host: lanServer ? true : undefined,
      https: lanServer?.https,
      allowedHosts: lanServer
        ? ['localhost', '.localhost', '127.0.0.1', lanServer.allowedHost]
        : ['localhost', '.localhost', '127.0.0.1'],
      // Keep a headed release journey on the source snapshot it booted with.
      // The dev bridge still uses Vite's websocket; only filesystem-triggered
      // HMR/full reloads are suppressed for this isolated test server.
      watch: freezeE2eSourceSnapshot ? { ignored: ['**/*'] } : { ignored: ['**/output/**'] },
      headers: {
        // Required for SharedArrayBuffer (FFmpeg multi-threaded, cross-tab sync)
        // Using 'credentialless' instead of 'require-corp' to allow CDN resources
        // (FFmpeg WASM from unpkg, transformers.js from HuggingFace)
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
        // Local development bridge can explicitly request bounded CPU samples.
        'Document-Policy': 'js-profiling',
      },
      proxy: hostedApiProxy,
    },
    preview: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'credentialless',
      },
    },
    worker: {
      // Runtime-host workers import split chunks, which requires the ES module format.
      format: 'es',
    },
    build: {
      target: 'esnext',
      chunkSizeWarningLimit: 6000,
      rollupOptions: {
        input: {
          editor: path.resolve(__dirname, 'index.html'),
          about: path.resolve(__dirname, 'about/index.html'),
        },
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
      // Generated test checkouts contain HTML copies; only the editor is an entry.
      entries: ['index.html'],
      esbuildOptions: {
        target: 'esnext',
      },
      // Exclude transformers.js and onnxruntime from pre-bundling
      exclude: ['@huggingface/transformers', 'onnxruntime-web'],
    },
  };
})
