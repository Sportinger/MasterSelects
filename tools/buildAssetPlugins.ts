// Build-output post-processing plugins. Both write into the build's resolved output directory
// (`build.outDir` / `build.assetsDir` / `base`), so `vite build --outDir <dir>` and custom
// `assetsDir` settings work, and neither writes anything when the dev server shuts down
// (Vite also calls closeBundle on dev server close).
import { gzipSync } from 'node:zlib';
import { mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';

export const SAM2_ORT_WASM_GZIP_PLACEHOLDER = '__SAM2_ORT_WASM_GZIP_URL__';
export const CLOUDFLARE_PAGES_MAX_ASSET_BYTES = 25 * 1024 * 1024;
const OVERSIZED_ORT_WASM = /^ort-wasm-simd-threaded\.jsep-.*\.wasm$/;

export interface BuildOutput {
  /** Absolute output directory of the build. */
  outDir: string;
  /** Absolute directory of the hashed assets. */
  assetsDir: string;
  /** Public URL prefix of the hashed assets, ending in '/'. */
  assetsUrl: string;
}

/** Where a finished `vite build` put its files, or null when nothing is written to disk. */
export function resolveBuildOutput(config: Pick<ResolvedConfig, 'command' | 'root' | 'base' | 'build'>): BuildOutput | null {
  if (config.command !== 'build' || config.build.write === false) return null;
  const outDir = path.resolve(config.root, config.build.outDir);
  const assetsSubdirectory = config.build.assetsDir.replace(/^\/+|\/+$/g, '');
  // Workers fetch the URL from their own location, so a relative base ('./', '') must become
  // root-relative; the deployed app is always served from the origin root then.
  const base = config.base && !config.base.startsWith('.') ? config.base : '/';
  const baseWithSlash = base.endsWith('/') ? base : `${base}/`;
  return {
    outDir,
    assetsDir: path.join(outDir, assetsSubdirectory),
    assetsUrl: assetsSubdirectory ? `${baseWithSlash}${assetsSubdirectory}/` : baseWithSlash,
  };
}

/** Serves the FFmpeg core in dev and copies it into `<outDir>/ffmpeg` after a build. */
export function ffmpegCoreAssets(coreDirectory: string): Plugin {
  const coreJsPath = path.join(coreDirectory, 'ffmpeg-core.js');
  const coreWasmPath = path.join(coreDirectory, 'ffmpeg-core.wasm');
  let compressedWasm: Buffer | null = null;
  let output: BuildOutput | null = null;
  const getCompressedWasm = () => {
    compressedWasm ??= gzipSync(readFileSync(coreWasmPath), { level: 9 });
    return compressedWasm;
  };

  return {
    name: 'ffmpeg-core-assets',
    configResolved(config) {
      output = resolveBuildOutput(config);
    },
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
      if (!output) return;
      const outputDirectory = path.join(output.outDir, 'ffmpeg');
      mkdirSync(outputDirectory, { recursive: true });
      writeFileSync(path.join(outputDirectory, 'ffmpeg-core.js'), readFileSync(coreJsPath));
      writeFileSync(path.join(outputDirectory, 'ffmpeg-core.wasm.gz'), getCompressedWasm());
    },
  };
}

/**
 * Cloudflare Pages rejects assets above 25 MiB. The SAM2 ONNX runtime WASM is larger, so it is
 * shipped gzip-compressed and the worker placeholder is pointed at the compressed file.
 */
export function compressOversizedSam2OrtWasm(maxAssetBytes = CLOUDFLARE_PAGES_MAX_ASSET_BYTES): Plugin {
  let output: BuildOutput | null = null;
  return {
    name: 'compress-oversized-sam2-ort-wasm',
    apply: 'build',
    configResolved(config) {
      output = resolveBuildOutput(config);
    },
    closeBundle() {
      if (!output) return;
      const { assetsDir, assetsUrl } = output;
      const oversizedWasmFiles = readdirSync(assetsDir).filter(fileName =>
        OVERSIZED_ORT_WASM.test(fileName) && readFileSync(path.join(assetsDir, fileName)).byteLength > maxAssetBytes);

      if (oversizedWasmFiles.length === 0) {
        return;
      }
      if (oversizedWasmFiles.length !== 1) {
        throw new Error(`Expected one oversized SAM2 ORT WASM asset, found ${oversizedWasmFiles.length}.`);
      }

      const wasmFileName = oversizedWasmFiles[0];
      const wasmPath = path.join(assetsDir, wasmFileName);
      const gzipFileName = `${wasmFileName}.gz`;
      const gzipBytes = gzipSync(readFileSync(wasmPath), { level: 9 });
      if (gzipBytes.byteLength > maxAssetBytes) {
        throw new Error(`Compressed SAM2 ORT WASM asset is still too large: ${gzipBytes.byteLength} bytes.`);
      }

      const workerMatches = readdirSync(assetsDir).filter(fileName => fileName.endsWith('.js')
        && readFileSync(path.join(assetsDir, fileName), 'utf8').includes(SAM2_ORT_WASM_GZIP_PLACEHOLDER));
      if (workerMatches.length === 0) {
        throw new Error('Missing SAM2 worker runtime placeholder.');
      }

      for (const workerFile of workerMatches) {
        const workerPath = path.join(assetsDir, workerFile);
        const workerSource = readFileSync(workerPath, 'utf8').replaceAll(
          SAM2_ORT_WASM_GZIP_PLACEHOLDER,
          `${assetsUrl}${gzipFileName}`,
        );
        writeFileSync(workerPath, workerSource);
      }
      writeFileSync(path.join(assetsDir, gzipFileName), gzipBytes);
      unlinkSync(wasmPath);
    },
  };
}
