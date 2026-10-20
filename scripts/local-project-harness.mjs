#!/usr/bin/env node
// Drives real project-folder flows (open, relink, grant folder access) in an
// isolated Chromium without a person at the native folder dialog.
//
// A local folder is served read-only on 127.0.0.1 and copied once into the
// harness browser's origin-private file system (OPFS). `showDirectoryPicker`
// then returns real FileSystemDirectoryHandles from that copy, so the editor's
// File System Access path runs unchanged through its own UI. The original
// folder is never written; the editor writes only into the copy.
//
// Usage:
//   node scripts/local-project-harness.mjs --folder "/path/to/Project" [--url http://localhost:5174/editor]
//     [--mount <name>=<folder> [--mount-include <name>=<path regex>]]...
//     [--step open | --step restore | --step pick:<relative dir> | --step pick:@<mount>[/<dir>] | --step click:<button name regex> | --step wait:<ms>
//      | --step waitText:<regex> | --step eval:<js expression>]... [--exclude <relative prefix>]...
//     [--profile <dir>] [--timeout <ms>] [--headed] [--channel chrome|chromium] [--report <file>] [--screenshot <file>]
//     [--real-gpu] [--measure-pipelines]
// --real-gpu opens a visible window on the hardware Vulkan driver (headless Chrome only has
// SwiftShader). --measure-pipelines additionally compiles every pipeline the editor creates
// asynchronously and reports the driver compile time per pipeline label (heaviest first).
// Mounts are further read-only folders (e.g. where offline media lives) for relink
// and folder-access flows. Default steps: open. The report (JSON) has the progress trace, the visible
// outcome, timings and the editor's runtime warnings/errors.
import { createReadStream, statSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

function parseArgs(argv) {
  const options = { url: 'http://localhost:5174/editor', steps: [], exclude: [], mounts: [], includes: {}, timeout: 300_000, headed: false, channel: 'chrome', realGpu: false, measurePipelines: false,
    profile: path.join(tmpdir(), 'ms-local-project-harness', 'profile') };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index], value = argv[index + 1];
    const take = () => { index += 1; if (value === undefined) throw new Error(`${name} needs a value`); return value; };
    if (name === '--folder') options.folder = path.resolve(take());
    else if (name === '--url') options.url = take();
    else if (name === '--step') options.steps.push(take());
    else if (name === '--exclude') options.exclude.push(take().replace(/^\/+|\/+$/g, ''));
    else if (name === '--mount') { const [mount, ...folder] = take().split('='); options.mounts.push({ name: mount, root: path.resolve(folder.join('=')) }); }
    else if (name === '--mount-include') { const [mount, ...pattern] = take().split('='); options.includes[mount] = new RegExp(pattern.join('=')); }
    else if (name === '--profile') options.profile = path.resolve(take());
    else if (name === '--timeout') options.timeout = Number(take());
    else if (name === '--report') options.report = path.resolve(take());
    else if (name === '--screenshot') options.screenshot = path.resolve(take());
    else if (name === '--headed') options.headed = true;
    else if (name === '--real-gpu') { options.realGpu = true; options.headed = true; }
    else if (name === '--measure-pipelines') options.measurePipelines = true;
    else if (name === '--channel') options.channel = take();
    else throw new Error(`Unknown argument: ${name}`);
  }
  if (!options.folder) throw new Error('--folder is required');
  if (!options.steps.length) options.steps.push('open');
  return options;
}

function listFolder(root, exclude, include) {
  const files = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true })) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (exclude.some(prefix => child === prefix || child.startsWith(`${prefix}/`))) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile() && (!include || include.test(child))) {
        const info = statSync(path.join(root, child));
        files.push({ path: child, size: info.size, mtime: Math.round(info.mtimeMs) });
      }
    }
  };
  walk('');
  return files;
}

/** Read-only, loopback-only file server for exactly the listed files of each mount. */
function serveFolders(mounts) {
  const byName = new Map(mounts.map(mount => [mount.name, { ...mount, allowed: new Set(mount.files.map(file => file.path)) }]));
  const server = createServer((request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const url = new URL(request.url, 'http://127.0.0.1');
    // A public origin (production) reaching loopback needs the private-network preflight.
    if (request.method === 'OPTIONS') {
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.setHeader('Access-Control-Allow-Methods', 'GET');
      response.writeHead(204).end(); return;
    }
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    const mount = byName.get(url.searchParams.get('mount') ?? '');
    if (!mount) { response.writeHead(404).end(); return; }
    if (url.pathname === '/__list') { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(mount.files)); return; }
    const relative = url.searchParams.get('path') ?? '';
    if (url.pathname !== '/file' || !mount.allowed.has(relative)) { response.writeHead(404).end(); return; }
    response.setHeader('Content-Type', 'application/octet-stream');
    createReadStream(path.join(mount.root, relative)).on('error', () => response.destroy()).pipe(response);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

// Runs in the page before the editor: answers folder/save pickers from OPFS.
function installPickers() {
  const queue = [];
  const opfsDirectory = async (relative) => {
    let directory = await navigator.storage.getDirectory();
    for (const part of relative.split('/').filter(Boolean)) directory = await directory.getDirectoryHandle(part, { create: true });
    return directory;
  };
  window.__harness = { queue, picked: [], opfsDirectory };
  // Harness sessions must not count as product usage (also against production).
  Object.defineProperty(Navigator.prototype, 'doNotTrack', { configurable: true, get: () => '1' });
  window.showDirectoryPicker = async () => {
    const next = queue.shift();
    window.__harness.picked.push(next ?? '(cancelled)');
    if (!next) throw new DOMException('The user aborted a request.', 'AbortError');
    return opfsDirectory(next);
  };
  window.showSaveFilePicker = async (options = {}) => {
    const directory = await opfsDirectory('harness-saves');
    return directory.getFileHandle(options.suggestedName || 'untitled', { create: true });
  };
  window.showOpenFilePicker = async () => { throw new DOMException('The user aborted a request.', 'AbortError'); };
}

// Runs in the page: times the driver compile of every pipeline the editor creates by
// compiling a twin asynchronously (measurement only; the editor keeps its own pipeline).
function installPipelineMeter() {
  const records = [];
  window.__harnessPipelines = records;
  // Drivers cache compiled pipelines, so each one is recompiled from a salted copy of its
  // shaders, one after another: the time is the driver compile, not cache or queue time.
  const sources = new WeakMap();
  const createShaderModule = GPUDevice.prototype.createShaderModule;
  GPUDevice.prototype.createShaderModule = function (descriptor) {
    const module = createShaderModule.call(this, descriptor);
    sources.set(module, descriptor.code);
    return module;
  };
  let queue = Promise.resolve();
  let salt = 0;
  const salted = (device, stage) => {
    if (!stage?.module || !sources.has(stage.module)) return stage;
    salt += 1;
    return { ...stage, module: createShaderModule.call(device, { code: `${sources.get(stage.module)}\nconst harness_salt_${salt}: u32 = ${salt}u;` }) };
  };
  const wrap = (proto, sync, async) => {
    const original = proto[sync];
    proto[sync] = function (descriptor) {
      const pipeline = original.call(this, descriptor);
      const label = descriptor.label || descriptor.fragment?.module?.label || descriptor.compute?.module?.label || descriptor.vertex?.module?.label || '(unlabeled)';
      const saltedCopy = () => {
        const copy = { ...descriptor, vertex: salted(this, descriptor.vertex), fragment: salted(this, descriptor.fragment), compute: salted(this, descriptor.compute) };
        for (const key of ['vertex', 'fragment', 'compute']) if (!copy[key]) delete copy[key];
        return copy;
      };
      // Best of two compiles, so compiler warm-up and load during project open do not count.
      queue = queue.then(async () => {
        let ms = Infinity, failure;
        for (let round = 0; round < 2; round += 1) {
          const started = performance.now();
          try { await this[async](saltedCopy()); } catch (error) { failure = String(error).slice(0, 200); }
          ms = Math.min(ms, Math.round(performance.now() - started));
        }
        records.push({ label, kind: sync, ms, ...(failure ? { error: failure } : {}) });
      });
      return pipeline;
    };
  };
  wrap(GPUDevice.prototype, 'createRenderPipeline', 'createRenderPipelineAsync');
  wrap(GPUDevice.prototype, 'createComputePipeline', 'createComputePipelineAsync');
}

// Runs in the page: copies the served folder into OPFS once per folder version.
async function importFolder({ server, mount, target, signature }) {
  const directory = await window.__harness.opfsDirectory(target);
  try {
    const marker = await (await (await directory.getFileHandle('.harness-import')).getFile()).text();
    if (marker === signature) return { reused: true };
  } catch { /* First import of this folder version. */ }
  const files = await (await fetch(`${server}/__list?mount=${encodeURIComponent(mount)}`)).json();
  let next = 0, bytes = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (next < files.length) {
      const file = files[next++];
      const parts = file.path.split('/');
      let parent = directory;
      for (const part of parts.slice(0, -1)) parent = await parent.getDirectoryHandle(part, { create: true });
      const handle = await parent.getFileHandle(parts.at(-1), { create: true });
      const response = await fetch(`${server}/file?mount=${encodeURIComponent(mount)}&path=${encodeURIComponent(file.path)}`);
      if (!response.ok) throw new Error(`Could not read ${file.path}: ${response.status}`);
      await response.body.pipeTo(await handle.createWritable());
      bytes += file.size;
    }
  }));
  const marker = await (await directory.getFileHandle('.harness-import', { create: true })).createWritable();
  await marker.write(signature); await marker.close();
  return { reused: false, files: files.length, bytes };
}

// Runs in the page: what a person would see, plus the editor's own diagnostics.
function observe() {
  const text = element => (element?.innerText ?? '').replace(/\s+/g, ' ').trim();
  const progress = [...document.querySelectorAll('[role=status]')].map(text).filter(Boolean).join(' | ');
  const dialog = document.querySelector('[role=dialog]');
  const alerts = [...document.querySelectorAll('[role=alert], [class*=error]')].map(text).filter(Boolean);
  return { progress, dialog: dialog ? text(dialog).slice(0, 400) : null, alerts: [...new Set(alerts)].slice(0, 5) };
}

function diagnostics() {
  const state = globalThis.__MASTERSELECTS_RUNTIME_DIAGNOSTICS__;
  return (state?.entries ?? []).filter(entry => entry.level === 'ERROR' || entry.level === 'WARN')
    .map(entry => `${entry.timestamp.slice(11, 23)} ${entry.level} ${entry.message.replace(/\s+/g, ' ').slice(0, 400)}`
      + (entry.stack && entry.level === 'ERROR' ? `\n    ${entry.stack.split('\n').slice(1, 6).join('\n    ')}` : ''));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const safe = (value) => value.replace(/[^\w.-]+/g, '_');
  const mounts = [{ name: 'project', root: options.folder, exclude: options.exclude, target: `harness/${safe(path.basename(options.folder))}` },
    ...options.mounts.map(mount => ({ ...mount, exclude: [], target: `harness/mounts/${safe(mount.name)}` }))]
    .map(mount => {
      const files = listFolder(mount.root, mount.exclude, options.includes[mount.name]);
      const include = options.includes[mount.name];
      const signature = JSON.stringify([mount.root, mount.exclude, ...(include ? [String(include)] : []), files.length,
        files.reduce((sum, file) => sum + file.size, 0), Math.max(0, ...files.map(file => file.mtime))]);
      return { ...mount, files, signature };
    });
  const target = mounts[0].target;
  const server = await serveFolders(mounts);
  const origin = `http://127.0.0.1:${server.address().port}`;
  mkdirSync(options.profile, { recursive: true });
  const report = { folder: options.folder, url: options.url, steps: options.steps, trace: [], startedAt: new Date().toISOString() };
  const startedAt = Date.now();
  const mark = (label) => report.trace.push(`${String(Date.now() - startedAt).padStart(7)}ms ${label}`);
  let context;
  try {
    // The installed Google Chrome by default (its own profile directory, never the person's);
    // `--channel chromium` uses Playwright's bundled build.
    context = await chromium.launchPersistentContext(options.profile, {
      channel: options.channel === 'chromium' ? undefined : options.channel,
      headless: !options.headed, viewport: { width: 1600, height: 1000 },
      // Only this throwaway profile: let production pages read the loopback file server.
      args: ['--enable-unsafe-webgpu', '--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights',
        ...(options.realGpu ? ['--enable-features=Vulkan,VulkanFromANGLE', '--use-angle=vulkan', '--ignore-gpu-blocklist'] : [])],
    });
    await context.addInitScript(installPickers);
    if (options.measurePipelines) await context.addInitScript(installPipelineMeter);
    const page = context.pages()[0] ?? await context.newPage();
    page.on('pageerror', error => mark(`pageerror ${error.message}`));
    // Confirm dialogs (project switch, leave page) are answered like a person continuing.
    page.on('dialog', dialog => { mark(`dialog ${dialog.type()}: ${dialog.message()}`); void dialog.accept(); });
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('.app--editor-layout, [role=dialog]').first().waitFor({ timeout: 120_000 });
    mark('editor shell visible');
    report.import = {};
    for (const mount of mounts) {
      report.import[mount.name] = await page.evaluate(importFolder, { server: origin, mount: mount.name, target: mount.target, signature: mount.signature });
    }
    mark(`folder in OPFS ${JSON.stringify(report.import)}`);
    let last = '';
    const watch = setInterval(async () => {
      try {
        const state = JSON.stringify(await page.evaluate(observe));
        if (state !== last) { last = state; mark(state); }
      } catch { /* Navigation in progress. */ }
    }, 400);
    for (const step of options.steps) {
      const [kind, ...rest] = step.split(':'); const argument = rest.join(':');
      mark(`step ${step}`);
      if (kind === 'open' || kind === 'restore') {
        // `restore` waits for the editor reopening the last project on its own.
        if (kind === 'open') {
          await page.evaluate(next => window.__harness.queue.push(next), target);
          const chooser = page.getByRole('button', { name: /Open existing/ });
          if (await chooser.isVisible().catch(() => false)) await chooser.click();
          else {
            await page.getByRole('button', { name: 'File', exact: true }).click();
            await page.getByRole('button', { name: /Open Project/ }).click();
          }
        }
        // Done when a load finished ("Project ready") or failed; a missing dialog alone can
        // mean the automatic reopen has not started yet.
        await page.waitForFunction(() => {
          const text = document.body.innerText;
          return /Project ready|Project load failed|could not be opened/i.test(text)
            || (/Choose project/.test(text) && /No recent projects|Open existing/.test(text) && !/Opening/.test(text));
        }, null, { timeout: options.timeout, polling: 500 });
        await page.waitForTimeout(800);
        await page.waitForFunction(() => ![...document.querySelectorAll('[role=status]')]
          .some(element => /Opening saved|Reading selected|Restoring (project|editor|last)|Reading saved|Importing legacy|Preparing recovery/i
            .test(element.textContent ?? '')),
        null, { timeout: options.timeout, polling: 500 }).catch(() => mark('load progress did not settle'));
      } else if (kind === 'pick') {
        const [first, ...rest] = argument.split('/');
        const base = first.startsWith('@') ? mounts.find(mount => mount.name === first.slice(1))?.target : `${target}/${first}`;
        if (!base) throw new Error(`Unknown mount in ${step}`);
        await page.evaluate(next => window.__harness.queue.push(next), [base, ...rest].join('/').replace(/\/+$/, ''));
      }
      else if (kind === 'click') await page.getByRole('button', { name: new RegExp(argument, 'i') }).first().click();
      else if (kind === 'wait') await page.waitForTimeout(Number(argument));
      else if (kind === 'waitText') await page.getByText(new RegExp(argument, 'i')).first().waitFor({ timeout: options.timeout });
      else if (kind === 'eval') report[`eval:${argument.slice(0, 40)}`] = await page.evaluate(argument);
      else throw new Error(`Unknown step: ${step}`);
      mark(`step done ${step}`);
    }
    await page.waitForTimeout(1500);
    clearInterval(watch);
    report.final = await page.evaluate(observe);
    report.picked = await page.evaluate(() => window.__harness.picked);
    report.diagnostics = await page.evaluate(diagnostics);
    if (options.measurePipelines) report.pipelines = await page.evaluate(() => (window.__harnessPipelines ?? []).toSorted((a, b) => b.ms - a.ms));
    if (options.screenshot) await page.screenshot({ path: options.screenshot });
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  } finally {
    report.durationMs = Date.now() - startedAt;
    await context?.close().catch(() => undefined);
    server.close();
  }
  const json = JSON.stringify(report, null, 2);
  if (options.report) writeFileSync(options.report, json);
  console.log(json);
  if (report.error) process.exitCode = 1;
}

main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
