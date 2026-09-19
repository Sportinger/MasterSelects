import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { BASELINE, sha, digest, json, save, inventory, sourceInputs, buildServer, prepare, contained, checkDependencies } from './pages-artifact.mjs';

const options = {};
const allowed = ['workspace', 'runtime', 'evidence', 'frontend-reference', 'dependencies'];
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i].replace(/^--/, ''), value = process.argv[i + 1];
  if (!allowed.includes(key) || options[key] || !value || !path.isAbsolute(value)) throw new Error('explicit_absolute_paths_required');
  options[key] = path.resolve(value);
}
if (allowed.some(key => !options[key])) throw new Error('Usage: --workspace ABS --runtime ABS --evidence ABS --frontend-reference ABS --dependencies ABS');
const { workspace, runtime, evidence } = options;
await contained(workspace, evidence);
await mkdir(evidence);
const source = await sourceInputs(workspace);
if (digest(source) !== digest(await sourceInputs(runtime))) throw new Error('baseline_source_mismatch');
const referenceFile = options['frontend-reference'];
const reference = await json(referenceFile);
if (reference.baseline !== BASELINE || reference.files !== 441 || reference.verdict !== 'BYTE_SERVING_PASSED') throw new Error('untrusted_frontend_report');
const frontend = path.join(runtime, 'dist');
const frontendFiles = await inventory(frontend);
if (frontendFiles.length !== reference.files) throw new Error('frontend_count_mismatch');
for (const file of frontendFiles) {
  const known = reference.probe.requests.find(r => r.path === file.path);
  if (!known?.passed || known.expectedDigest !== file.sha256 || known.sizeBytes !== file.size) throw new Error(`frontend_hash_mismatch:${file.path}`);
}
const dependencies = await json(options.dependencies);
const bundlerInputs = dependencies.filter(f => /^node_modules\/(wrangler\/|esbuild\/|@esbuild\/|path-to-regexp\/)/.test(f.path));
if (!bundlerInputs.length) throw new Error('missing_dependency_closure');
await checkDependencies(runtime, { bundlerInputs, bundlerDigest: digest(bundlerInputs) });
for (const file of bundlerInputs) {
  if (sha(await readFile(path.join(runtime, file.path))) !== file.sha256) throw new Error(`bundler_changed:${file.path}`);
}
const wranglerVersion = (await json(path.join(runtime, 'node_modules/wrangler/package.json'))).version;
if (wranglerVersion !== '4.118.0') throw new Error('unqualified_wrangler');
const first = path.join(evidence, 'build-1'), second = path.join(evidence, 'build-2');
const serverFiles = await buildServer(workspace, runtime, first);
const repeated = await buildServer(workspace, runtime, second);
if (digest(serverFiles) !== digest(repeated)) throw new Error('nondeterministic_server_bytes');
if (sha(await readFile(path.join(first, 'routes.json'))) !== sha(await readFile(path.join(second, 'routes.json')))) throw new Error('nondeterministic_routes');
if (sha(await readFile(path.join(first, 'routes-config.json'))) !== sha(await readFile(path.join(second, 'routes-config.json')))) throw new Error('nondeterministic_route_config');
if (digest(await sourceInputs(workspace)) !== digest(source)) throw new Error('source_changed_during_build');
// Fail closed on newly introduced build inputs outside the reviewed closure.
for (const build of [first, second]) {
const meta = await json(path.join(build, 'metafile.json'));
for (const name of Object.keys(meta.inputs)) {
  const full = path.resolve(workspace, 'functions', name);
  if (full.startsWith(path.join(workspace, '.wrangler/tmp') + path.sep) && /functionsRoutes-[^/\\]+\.mjs$/.test(full)) continue;
  const sourcePath = path.relative(workspace, full).replaceAll('\\', '/');
  const dependencyPath = path.relative(runtime, full).replaceAll('\\', '/');
  if (!source.some(f => f.path === sourcePath) && !bundlerInputs.some(f => f.path === dependencyPath)) {
    throw new Error(`unqualified_build_input:${name}`);
  }
}
}
for (const file of bundlerInputs) {
  if (sha(await readFile(path.join(runtime, file.path))) !== file.sha256) throw new Error('bundler_changed_during_build');
}
const envSource = await readFile(path.join(workspace, 'functions/lib/env.ts'), 'utf8');
const envFields = [...envSource.split('export interface Env {')[1].split('\n}')[0].matchAll(/^\s+([A-Z][A-Z0-9_]*)(\?)?:\s*([^;]+);/gm)]
  .map(m => ({ name: m[1], optionalInType: !!m[2], type: m[3] }));
const contract = { schema: 'pages-bindings-contract/v1', compatibilityDate: '2026-03-18', compatibilityFlags: [],
  implicitBindings: ['ASSETS'], productionConfiguredBindings: ['DB', 'KV', 'KIEAI_GENERATION_RATE_LIMITER'],
  envFields, configSha256: sha(await readFile(path.join(workspace, 'wrangler.toml'))),
  unresolved: ['Reconcile production configuration with live Pages project without exposing secret values',
    'MEDIA is required by Env type but no R2 binding appears in wrangler.toml; confirm usage and production requirement',
    'Verify session/OAuth/kernel endpoint and token presence via names/status only',
    'Verify external Durable Object deployment and D1 schema/migrations; no migrations executed'],
  secretValuesIncluded: false, accountVerified: false };
const inputs = { baseline: BASELINE, sourceDigest: digest(source), sourceFiles: source,
  frontendFiles, priorFrontendOnlyDigest: reference.expectedArtifactDigest, priorReportSha256: sha(await readFile(referenceFile)),
  wranglerVersion, bundlerInputs, bundlerDigest: digest(bundlerInputs), nodeVersion: process.version,
  nodeExecutableSha256: sha(await readFile(process.execPath)), serverFiles,
  routesDigest: sha(await readFile(path.join(first, 'routes.json'))),
  routeConfigDigest: sha(await readFile(path.join(first, 'routes-config.json'))), bindingDigest: digest(contract),
  repeatedServerBytesEqual: true, buildCommand: (await json(path.join(first, 'command.json'))).command };
await save(path.join(evidence, 'inputs.json'), inputs);
await save(path.join(evidence, 'bindings.json'), contract);
const destination = path.join(evidence, 'pages-artifact');
const seal = await prepare({ workspace, runtime, frontend, server: path.join(first, 'server'), routes: path.join(first, 'routes.json'),
  routeConfig: path.join(first, 'routes-config.json'), contract, inputs, destination });
const report = { baseline: BASELINE, sourceDigest: inputs.sourceDigest, bundlerDigest: inputs.bundlerDigest,
  serverFiles, routesDigest: inputs.routesDigest, bindingDigest: inputs.bindingDigest,
  artifactDigest: seal.artifactDigest, sealSha256: sha(await readFile(path.join(destination, 'seal.json'))),
  artifactFiles: seal.files.length, frontendFiles: frontendFiles.length, functionsFiles: 109,
  repeatedBuildBytesEqual: true, classification: seal.classification, liveApiVerified: false, browserVerified: false,
  rollbackVerified: false, deploymentQualified: false };
await save(path.join(evidence, 'report.json'), report);
console.log(JSON.stringify(report, null, 2));
