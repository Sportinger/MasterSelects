import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/version'
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

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const isDevServer = command === 'serve';
  const enableDevBridge = isDevServer && mode !== 'test';
  const freezeE2eSourceSnapshot = process.env.MASTERSELECTS_E2E_FREEZE_SOURCE === '1';
  const hostedApiProxyTarget = 'http://127.0.0.1:8788';
  const hostedApiProxyRoutes = [
    '/api/me',
    '/api/auth',
    '/api/billing',
    '/api/credits',
    '/api/support',
    '/api/stripe',
    '/api/ai/chat',
    '/api/ai/audio',
    '/api/ai/video',
    '/api/kernel',
    '/api/visits',
    '/api/admin',
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
      // Keep a headed release journey on the source snapshot it booted with.
      // The dev bridge still uses Vite's websocket; only filesystem-triggered
      // HMR/full reloads are suppressed for this isolated test server.
      watch: freezeE2eSourceSnapshot ? { ignored: ['**/*'] } : undefined,
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
    worker: {
      // Runtime-host workers import split chunks, which requires the ES module format.
      format: 'es',
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
