import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { APP_VERSION } from './src/version'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
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
  },
  server: {
    headers: {
      // Required for SharedArrayBuffer (FFmpeg multi-threaded, cross-tab sync)
      // Using 'credentialless' instead of 'require-corp' to allow CDN resources
      // (FFmpeg WASM from unpkg, transformers.js from HuggingFace)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
    },
    // Exclude transformers.js and onnxruntime from pre-bundling
    exclude: ['@huggingface/transformers', 'onnxruntime-web'],
  },
})
