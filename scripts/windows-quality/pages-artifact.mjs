import { readFile, writeFile, readdir, lstat, mkdir, copyFile, realpath, rename } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { constants } from 'node:fs';

export const BASELINE = '82631b1d2a58cdf33fe8256127adb9053294a9f3';
export const sha = value => createHash('sha256').update(value).digest('hex');
export const digest = value => sha(JSON.stringify(value));
export const json = async file => JSON.parse(await readFile(file, 'utf8'));
export const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const requireTrue = (condition, reason) => { if (!condition) throw new Error(reason); };
export async function inventory(root) {
  const files = [];
  async function visit(rel) {
    const full = path.join(root, rel), stat = await lstat(full);
    requireTrue(!stat.isSymbolicLink(), `link_rejected:${rel}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(full)).toSorted()) await visit(rel ? `${rel}/${name}` : name);
    } else {
      requireTrue(stat.isFile(), `nonfile:${rel}`);
      const bytes = await readFile(full);
      files.push({ path: rel, size: bytes.length, sha256: sha(bytes) });
    }
  }
  await visit('');
  return files;
}
export async function sourceInputs(root) {
  const files = [];
  for (const dir of ['functions', 'src', 'migrations', 'content']) {
    for (const file of await inventory(path.join(root, dir))) files.push({ ...file, path: `${dir}/${file.path}` });
  }
  for (const name of ['wrangler.toml', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.functions.json']) {
    requireTrue((await lstat(path.join(root, name))).isFile() && !(await lstat(path.join(root, name))).isSymbolicLink(), `link_or_nonfile:${name}`);
    const bytes = await readFile(path.join(root, name));
    files.push({ path: name, size: bytes.length, sha256: sha(bytes) });
  }
  requireTrue(files.filter(f => f.path.startsWith('functions/')).length === 109, 'missing_serverfunctions');
  return files;
}
export async function assertInventory(root, expected, reason) {
  requireTrue(digest(await inventory(root)) === digest(expected), reason);
}
export async function contained(workspace, output) {
  const root = await realpath(workspace);
  const target = path.resolve(output);
  requireTrue(target.startsWith(root + path.sep), 'output_outside_workspace');
  // Check every existing ancestor; lexical containment alone accepts junction escapes.
  let parent = path.dirname(target);
  while (parent !== root) {
    try { requireTrue((await realpath(parent)).startsWith(root + path.sep), 'output_link_escape'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    parent = path.dirname(parent);
  }
  return target;
}
export async function buildServer(workspace, runtime, output) {
  await contained(workspace, output);
  await mkdir(output); // Existing output is never silently reconstructed.
  const tmp = path.join(output, 'tmp'); await mkdir(tmp);
  const cli = path.join(runtime, 'node_modules/wrangler/bin/wrangler.js');
  const command = [cli, 'pages', 'functions', 'build', 'functions', '--outdir', path.join(output, 'server'),
    '--output-routes-path', path.join(output, 'routes.json'), '--output-config-path', path.join(output, 'routes-config.json'),
    '--metafile', path.join(output, 'metafile.json'), '--build-output-directory', path.join(output, 'assets'),
    '--compatibility-date', '2026-03-18', '--minify'];
  // No inherited credentials, user config, account identity, or proxy settings.
  const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: tmp, TMP: tmp,
    NODE_PATH: path.join(runtime, 'node_modules'),
    HOME: tmp, USERPROFILE: tmp, APPDATA: tmp, LOCALAPPDATA: tmp, XDG_CONFIG_HOME: tmp,
    WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(output, 'wrangler.log'), CI: 'true' };
  const run = spawnSync(process.execPath, command, { cwd: workspace, env, encoding: 'utf8', timeout: 60000, windowsHide: true });
  await writeFile(path.join(output, 'build.log'), (run.stdout ?? '') + (run.stderr ?? ''), { flag: 'wx' });
  await save(path.join(output, 'command.json'), { executable: process.execPath, command, status: run.status, error: run.error?.message });
  requireTrue(run.status === 0, 'functions_build_failed');
  const files = await inventory(path.join(output, 'server'));
  requireTrue(files.length === 1 && files[0].path === 'index.js', 'unqualified_worker_entry_shape');
  return files;
}
export async function checkDependencies(runtime, inputs) {
  requireTrue(Array.isArray(inputs.bundlerInputs) && digest(inputs.bundlerInputs) === inputs.bundlerDigest, 'invalid_bundler_pin');
  if (!inputs.bundlerInputs.length) return; // Synthetic fixtures; qualification requires the real closure.
  const actual = [];
  for (const dir of ['wrangler', 'esbuild', '@esbuild', 'path-to-regexp']) {
    for (const f of await inventory(path.join(runtime, 'node_modules', dir))) actual.push({ ...f, path: `node_modules/${dir}/${f.path}` });
  }
  const ordered = files => files.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireTrue(digest(ordered(actual)) === digest(ordered(inputs.bundlerInputs)), 'bundler_changed');
}
function validFiles(files) {
  requireTrue(Array.isArray(files), 'invalid_input_inventory');
  const paths = new Set();
  for (const f of files) {
    requireTrue(typeof f.path === 'string' && f.path.length > 0 && !/[\\:]/.test(f.path)
      && f.path.split('/').every(p => p && p !== '.' && p !== '..')
      && !paths.has(f.path.toLowerCase()) && Number.isSafeInteger(f.size) && f.size >= 0
      && /^[a-f0-9]{64}$/.test(f.sha256), 'invalid_input_inventory');
    paths.add(f.path.toLowerCase());
  }
}
export async function assertMapping(directory, files, inputs, expectedBaseline = BASELINE) {
  requireTrue(/^[a-f0-9]{40}$/.test(expectedBaseline), 'invalid_expected_baseline');
  requireTrue(inputs.baseline === expectedBaseline && inputs.wranglerVersion === '4.118.0', 'incorrect_baseline_or_bundler');
  for (const list of [inputs.frontendFiles, inputs.serverFiles, inputs.sourceFiles]) validFiles(list);
  requireTrue(digest(inputs.sourceFiles) === inputs.sourceDigest, 'invalid_source_pin');
  requireTrue(inputs.serverFiles.length === 1 && inputs.serverFiles[0].path === 'index.js', 'incorrect_entrypoint');
  requireTrue(!inputs.frontendFiles.some(f => /^(_worker\.|_routes\.json|functions\/)/i.test(f.path)), 'frontend_contains_server');
  const config = inputs.sourceFiles.find(f => f.path === 'wrangler.toml');
  requireTrue(!!config, 'missing_config_pin');
  const expected = [...inputs.frontendFiles.map(f => ({ ...f, path: `assets/${f.path}` })),
    { ...inputs.serverFiles[0], path: 'assets/_worker.js/index.js' },
    { ...config, path: 'wrangler.source.toml' }];
  for (const [name, hash] of [['assets/_routes.json', inputs.routesDigest], ['routes-config.json', inputs.routeConfigDigest]]) {
    const bytes = await readFile(path.join(directory, name));
    requireTrue(sha(bytes) === hash, `input_artifact_mismatch:${name}`);
    expected.push({ path: name, size: bytes.length, sha256: hash });
  }
  const routes = await json(path.join(directory, 'assets/_routes.json'));
  requireTrue(routes.version === 1 && digest(routes.include) === digest(['/*']) && digest(routes.exclude) === digest([]), 'middleware_route_lost');
  const bindingBytes = await readFile(path.join(directory, 'bindings.json'));
  const contract = JSON.parse(bindingBytes);
  requireTrue(digest(contract) === inputs.bindingDigest && contract.configSha256 === config.sha256
    && bindingBytes.equals(Buffer.from(JSON.stringify(contract, null, 2) + '\n')), 'binding_contract_changed');
  expected.push({ path: 'bindings.json', size: bindingBytes.length, sha256: sha(bindingBytes) });
  const ordered = list => list.toSorted((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  requireTrue(digest(ordered(files)) === digest(ordered(expected)), 'input_artifact_mismatch');
}
export async function prepare({ workspace, frontend, server, routes, routeConfig, runtime, contract, inputs, destination, expectedBaseline = BASELINE }) {
  inputs = structuredClone(inputs);
  contract = structuredClone(contract);
  await contained(workspace, destination);
  requireTrue(/^[a-f0-9]{40}$/.test(expectedBaseline), 'invalid_expected_baseline');
  requireTrue(inputs.baseline === expectedBaseline && inputs.wranglerVersion === '4.118.0', 'incorrect_baseline_or_bundler');
  requireTrue(digest(await sourceInputs(workspace)) === inputs.sourceDigest, 'source_changed_or_reconstruction');
  await assertInventory(frontend, inputs.frontendFiles, 'frontend_changed');
  await assertInventory(server, inputs.serverFiles, 'missing_or_stale_bundle');
  requireTrue(inputs.serverFiles.length === 1 && inputs.serverFiles[0].path === 'index.js', 'incorrect_entrypoint');
  const routeBytes = await readFile(routes);
  requireTrue(sha(routeBytes) === inputs.routesDigest, 'route_changed');
  const routing = JSON.parse(routeBytes);
  requireTrue(routing.version === 1 && digest(routing.include) === digest(['/*']) && routing.exclude.length === 0, 'middleware_route_lost');
  requireTrue(digest(contract) === inputs.bindingDigest, 'binding_contract_changed');
  requireTrue(!inputs.frontendFiles.some(f => /^(_worker\.|_routes\.json|functions\/)/.test(f.path)), 'frontend_contains_server');
  for (const list of [inputs.frontendFiles, inputs.serverFiles, inputs.sourceFiles]) validFiles(list);
  const routeConfigBytes = await readFile(routeConfig);
  requireTrue(sha(routeConfigBytes) === inputs.routeConfigDigest, 'route_config_changed');
  await checkDependencies(runtime, inputs);
  await mkdir(destination);
  const assets = path.join(destination, 'assets'); await mkdir(assets);
  for (const file of inputs.frontendFiles) {
    const target = path.join(assets, file.path); await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(frontend, file.path), target, constants.COPYFILE_EXCL);
  }
  await mkdir(path.join(assets, '_worker.js'));
  await copyFile(path.join(server, 'index.js'), path.join(assets, '_worker.js/index.js'), constants.COPYFILE_EXCL);
  await writeFile(path.join(assets, '_routes.json'), routeBytes, { flag: 'wx' });
  await save(path.join(destination, 'bindings.json'), contract);
  await copyFile(path.join(workspace, 'wrangler.toml'), path.join(destination, 'wrangler.source.toml'), constants.COPYFILE_EXCL);
  await writeFile(path.join(destination, 'routes-config.json'), routeConfigBytes, { flag: 'wx' });
  await assertInventory(frontend, inputs.frontendFiles, 'frontend_changed_during_staging');
  await assertInventory(server, inputs.serverFiles, 'server_changed_during_staging');
  requireTrue(sha(await readFile(routes)) === inputs.routesDigest, 'route_changed_during_staging');
  requireTrue(sha(await readFile(routeConfig)) === inputs.routeConfigDigest, 'route_config_changed_during_staging');
  requireTrue(digest(await sourceInputs(workspace)) === inputs.sourceDigest, 'source_changed_during_staging');
  await checkDependencies(runtime, inputs);
  const files = await inventory(destination);
  await assertMapping(destination, files, inputs, expectedBaseline);
  const seal = { schema: 'pages-artifact-completeness/v2', baseline: expectedBaseline, inputs,
    classification: 'frontend-plus-functions-bytes', liveApiVerified: false, browserVerified: false,
    rollbackVerified: false, deploymentQualified: false, files, artifactDigest: digest(files) };
  await save(path.join(destination, 'seal.json'), seal);
  try { await verify(destination, sha(await readFile(path.join(destination, 'seal.json'))), expectedBaseline); }
  catch (error) {
    // Preserve failed bytes for diagnosis, but never leave a success seal after failure.
    await rename(path.join(destination, 'seal.json'), path.join(destination, 'failed-seal.json'));
    throw error;
  }
  return seal;
}
export async function verify(directory, trustedSealSha256, expectedBaseline = BASELINE) {
  requireTrue(/^[a-f0-9]{40}$/.test(expectedBaseline), 'invalid_expected_baseline');
  const bytes = await readFile(path.join(directory, 'seal.json'));
  requireTrue(sha(bytes) === trustedSealSha256, 'untrusted_seal');
  const seal = JSON.parse(bytes);
  requireTrue(seal.schema === 'pages-artifact-completeness/v2' && seal.baseline === expectedBaseline, 'invalid_seal');
  const files = (await inventory(directory)).filter(f => f.path !== 'seal.json');
  requireTrue(digest(files) === seal.artifactDigest && digest(files) === digest(seal.files), 'artifact_tampered_or_missing');
  requireTrue(files.some(f => f.path === 'assets/_worker.js/index.js') && files.some(f => f.path === 'assets/_routes.json')
    && files.some(f => f.path === 'bindings.json') && files.some(f => f.path === 'wrangler.source.toml'), 'incomplete_pages_artifact');
  await assertMapping(directory, files, seal.inputs, expectedBaseline);
  return seal;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv[2] !== 'verify' || !process.argv[4]) throw new Error('Usage: node pages-artifact.mjs verify DIRECTORY TRUSTED_SEAL_SHA256 [EXPECTED_BASELINE]');
  const seal = await verify(path.resolve(process.argv[3]), process.argv[4], process.argv[5]);
  console.log(JSON.stringify({ classification: seal.classification, artifactDigest: seal.artifactDigest, files: seal.files.length }));
}
