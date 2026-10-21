// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import type { Plugin, ResolvedConfig } from 'vite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  compressOversizedSam2OrtWasm,
  ffmpegCoreAssets,
  resolveBuildOutput,
  SAM2_ORT_WASM_GZIP_PLACEHOLDER,
} from '../../tools/buildAssetPlugins';

type ConfigShape = Pick<ResolvedConfig, 'command' | 'root' | 'base' | 'build'>;

let root: string;

function config(overrides: { command?: 'build' | 'serve'; outDir?: string; assetsDir?: string; base?: string; write?: boolean } = {}): ConfigShape {
  return {
    command: overrides.command ?? 'build',
    root,
    base: overrides.base ?? '/',
    build: { outDir: overrides.outDir ?? 'dist', assetsDir: overrides.assetsDir ?? 'assets', write: overrides.write ?? true },
  } as ConfigShape;
}

function finishBuild(plugin: Plugin, resolved: ConfigShape): void {
  (plugin.configResolved as (this: unknown, value: ConfigShape) => void).call({}, resolved);
  (plugin.closeBundle as (this: unknown) => void).call({});
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'build-asset-plugins-'));
  mkdirSync(path.join(root, 'core'));
  writeFileSync(path.join(root, 'core', 'ffmpeg-core.js'), 'core-js');
  writeFileSync(path.join(root, 'core', 'ffmpeg-core.wasm'), 'core-wasm');
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('build asset plugins', () => {
  it('resolves the configured outDir, assetsDir and base instead of a fixed dist', () => {
    expect(resolveBuildOutput(config({ outDir: 'out/x', assetsDir: 'static', base: '/app' }))).toEqual({
      outDir: path.join(root, 'out', 'x'), assetsDir: path.join(root, 'out', 'x', 'static'), assetsUrl: '/app/static/',
    });
    expect(resolveBuildOutput(config({ base: './' }))?.assetsUrl).toBe('/assets/');
    expect(resolveBuildOutput(config({ command: 'serve' }))).toBeNull();
    expect(resolveBuildOutput(config({ write: false }))).toBeNull();
  });

  it('copies the FFmpeg core into the build outDir passed with --outDir', () => {
    finishBuild(ffmpegCoreAssets(path.join(root, 'core')), config({ outDir: 'custom-out' }));
    expect(readFileSync(path.join(root, 'custom-out', 'ffmpeg', 'ffmpeg-core.js'), 'utf8')).toBe('core-js');
    expect(gunzipSync(readFileSync(path.join(root, 'custom-out', 'ffmpeg', 'ffmpeg-core.wasm.gz'))).toString()).toBe('core-wasm');
    expect(existsSync(path.join(root, 'dist'))).toBe(false);
  });

  it('writes nothing when the dev server closes', () => {
    finishBuild(ffmpegCoreAssets(path.join(root, 'core')), config({ command: 'serve' }));
    expect(existsSync(path.join(root, 'dist'))).toBe(false);
  });

  it('gzips the oversized SAM2 runtime in the configured assets directory and points the worker at it', () => {
    const assetsDir = path.join(root, 'build', 'static');
    mkdirSync(assetsDir, { recursive: true });
    const wasmName = 'ort-wasm-simd-threaded.jsep-abc.wasm';
    writeFileSync(path.join(assetsDir, wasmName), Buffer.alloc(4096, 1));
    writeFileSync(path.join(assetsDir, 'sam2Worker-x.js'), `fetch("${SAM2_ORT_WASM_GZIP_PLACEHOLDER}")`);
    writeFileSync(path.join(assetsDir, 'other.js'), 'export {}');

    finishBuild(compressOversizedSam2OrtWasm(1024), config({ outDir: 'build', assetsDir: 'static' }));

    expect(existsSync(path.join(assetsDir, wasmName))).toBe(false);
    expect(gunzipSync(readFileSync(path.join(assetsDir, `${wasmName}.gz`))).byteLength).toBe(4096);
    expect(readFileSync(path.join(assetsDir, 'sam2Worker-x.js'), 'utf8')).toBe(`fetch("/static/${wasmName}.gz")`);
  });

  it('leaves a runtime below the asset limit and its placeholder alone', () => {
    const assetsDir = path.join(root, 'dist', 'assets');
    mkdirSync(assetsDir, { recursive: true });
    writeFileSync(path.join(assetsDir, 'ort-wasm-simd-threaded.jsep-abc.wasm'), Buffer.alloc(512));
    finishBuild(compressOversizedSam2OrtWasm(1024), config());
    expect(existsSync(path.join(assetsDir, 'ort-wasm-simd-threaded.jsep-abc.wasm'))).toBe(true);
  });
});
