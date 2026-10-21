// Effect documentation from the effect registry: writes docs/Features/effects/catalog.json,
// refreshes the generated controls tables in effect pages and keeps basic pages current.
// Hand-written effect pages are never rewritten: only their <!-- generated:controls --> blocks. A basic
// page edited under its marker is reported and left alone (delete the marker to keep the edit).
//
//   node scripts/effect-docs.mjs                       # catalog.json, generated blocks, basic pages
//   node scripts/effect-docs.mjs --check               # change nothing; exit 1 when something is stale
//   node scripts/effect-docs.mjs --basic               # also write basic pages for effects that have no page
//   node scripts/effect-docs.mjs --basic halftone,print   # ...for these effect or picker group ids
//   node scripts/effect-docs.mjs --lab-manifest <file> # Effect Lab --pairs manifest for basic pages
//                                                      # without a still (render it, then rerun this)
//       [--reshoot <effect or group ids>]              # ...also for these basic pages that have one
//   node scripts/effect-docs.mjs --thumbs [--force [ids]] # gallery thumbnails from the effect stills (an effect's
//                                                      # `thumb` in effectDocsExtras.mjs picks the region or
//                                                      # names the Effect Lab shot file that makes it); --force
//                                                      # remakes them all, or only these effect or group ids
//   node scripts/effect-docs.mjs --uncovered           # list visible effects without a page
//   node scripts/effect-docs.mjs --controls <id>       # print an effect's controls block (to paste into a new page)
//
// The registry is TypeScript: it is loaded through Vite (no dev server, no config file, no browser).
// Rules for effect pages: docs/Features/Documentation-Site.md ("Effect pages").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLS_END, CONTROLS_START, LAB_STILL_SKIP, THUMB_TARGET_BYTES, controlsTable, effectAssets, isBasicPage, labPair, pageFile, planEffectDocs, snapshotRegistry } from './effectDocsCatalog.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const featuresDir = path.join(root, 'docs', 'Features');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith('--') ? value : '';
};
const check = args.includes('--check');
const feature = (file) => path.join(featuresDir, file);
const read = (file) => (fs.existsSync(feature(file)) ? fs.readFileSync(feature(file), 'utf8') : undefined);
const exists = (file) => fs.existsSync(feature(file));
const listPages = () => (fs.existsSync(feature('effects'))
  ? fs.readdirSync(feature('effects')).filter((name) => name.endsWith('.md') && name !== 'index.md').map((name) => name.slice(0, -3)).toSorted()
  : []);

/** The registry as plain data, loaded through Vite's SSR module loader. */
async function loadRegistry() {
  const { createServer } = await import('vite');
  const server = await createServer({
    root, configFile: false, logLevel: 'error', appType: 'custom',
    server: { middlewareMode: true, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
    resolve: { alias: { '@': path.join(root, 'src') } },
    define: { __APP_VERSION__: '"docs"', __SHOW_CHANGELOG__: 'false', __DEV_BRIDGE_TOKEN__: '""', __DEV_ALLOWED_FILE_ROOTS__: '[]' },
  });
  try {
    const effects = await server.ssrLoadModule('/src/effects/index.ts');
    const { catalogText } = await server.ssrLoadModule('/src/services/nodeGraph/catalogText.ts');
    const { effectParamDisplay } = await server.ssrLoadModule('/src/effects/paramDisplay.ts');
    return snapshotRegistry({
      effects: effects.getAllEffects(), groups: effects.EFFECT_GROUPS, hidden: effects.EFFECTS_HIDDEN_FROM_CATALOG,
      engineOf: effects.effectEngine, engineMembers: effects.effectEngineMembers, text: catalogText,
      display: effectParamDisplay, experimental: effects.effectExperimentalNote,
    });
  } finally {
    await server.close();
  }
}

const snapshot = await loadRegistry();
const notes = [];

const controlsFor = option('--controls');
if (controlsFor !== undefined) {
  const effect = snapshot.effects.find((entry) => entry.id === controlsFor);
  if (!effect) throw new Error(`--controls: "${controlsFor}" is not an effect id.`);
  console.log(`${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`);
  process.exit(0);
}

// Gallery thumbnails first (the catalog lists them): the effect half of the still, 400 x 250 WebP (smaller if needed).
if (args.includes('--thumbs') && !check) {
  const { default: sharp } = await import('sharp');
  const forceOption = option('--force');
  const forceIds = forceOption ? forceOption.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  const forced = (effect) => forceOption !== undefined && (!forceIds || forceIds.includes(effect.id) || forceIds.includes(effect.group));
  for (const effect of snapshot.effects) {
    const assets = effectAssets(effect.id);
    const source = [assets.still, assets.poster].find(exists);
    if (!source || (exists(assets.thumb) && !forced(effect))) continue;
    const thumb = EFFECT_DOC_EXTRAS[effect.id]?.thumb;
    if (thumb?.shot) { notes.push(`${assets.thumb}: made by node scripts/effect-lab.mjs --pairs ${thumb.shot} --only ${effect.id}; left alone.`); continue; }
    const { width, height } = await sharp(feature(source)).metadata();
    // Stills show "original | effect" side by side, or stacked when taller than wide: keep the effect half
    // (or the region the extras name, as fractions of the still: [left, top, width, height]).
    const region = thumb?.region
      ? { left: Math.round(thumb.region[0] * width), top: Math.round(thumb.region[1] * height), width: Math.round(thumb.region[2] * width), height: Math.round(thumb.region[3] * height) }
      : height > width * 0.9
        ? { left: 0, top: Math.ceil(height / 2), width, height: Math.floor(height / 2) }
        : { left: Math.ceil(width / 2), top: 0, width: Math.floor(width / 2), height };
    // Lower the quality first, then the size, until the thumbnail fits (fine line patterns compress badly).
    let buffer;
    search: for (const [width, height] of [[400, 250], [352, 220], [320, 200]]) {
      for (let quality = 72; quality >= 40; quality -= 8) {
        buffer = await sharp(feature(source)).extract(region).resize(width, height, { fit: 'cover', position: 'attention' }).webp({ quality }).toBuffer();
        if (buffer.length <= THUMB_TARGET_BYTES) break search;
      }
    }
    fs.mkdirSync(path.dirname(feature(assets.thumb)), { recursive: true });
    fs.writeFileSync(feature(assets.thumb), buffer);
    console.log(`${assets.thumb}: ${buffer.length} bytes from ${source}`);
  }
}

// New basic pages: the listed effect or group ids, or every visible effect without a page.
const basicOption = option('--basic');
let basic = [];
if (basicOption !== undefined) {
  const groupIds = new Set(snapshot.groups.map((group) => group.id));
  const wanted = basicOption ? basicOption.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  for (const item of wanted ?? []) {
    if (!groupIds.has(item) && !snapshot.effects.some((effect) => effect.id === item)) notes.push(`--basic: "${item}" is neither an effect nor a picker group id.`);
  }
  basic = wanted
    ? snapshot.effects.filter((effect) => wanted.includes(effect.id) || wanted.includes(effect.group)).map((effect) => effect.id)
    : planEffectDocs(snapshot, { read, exists, pages: listPages() }).uncovered.map((effect) => effect.id);
}

const plan = planEffectDocs(snapshot, { read, exists, pages: listPages() }, { basic });
for (const id of plan.unknownPages) notes.push(`effects/${id}.md: "${id}" is not an effect id of the registry; the page is left alone.`);
for (const problem of plan.problems) notes.push(problem.text);
if (plan.problems.length) process.exitCode = 1;
const changes = [...plan.texts].filter(([file, text]) => read(file) !== text).map(([file]) => file);
if (!check) {
  for (const file of changes) {
    fs.mkdirSync(path.dirname(feature(file)), { recursive: true });
    fs.writeFileSync(feature(file), plan.texts.get(file));
  }
}

// Effect Lab manifest for basic pages without a still (moving effects get one frame until they have a loop).
const manifestFile = option('--lab-manifest');
if (manifestFile) {
  const reshoot = (option('--reshoot') ?? '').split(',').map((item) => item.trim()).filter(Boolean);
  const pairs = snapshot.effects
    .filter((effect) => isBasicPage(plan.texts.get(pageFile(effect.id)) ?? '')
      && (!exists(effectAssets(effect.id).still) || reshoot.includes(effect.id) || reshoot.includes(effect.group)))
    .filter((effect) => !LAB_STILL_SKIP[effect.id] || void notes.push(`${effect.id}: no Effect Lab still, it ${LAB_STILL_SKIP[effect.id]}.`))
    .map(labPair);
  fs.writeFileSync(path.resolve(manifestFile), `${JSON.stringify({ pairs }, null, 2)}\n`);
  console.log(`${manifestFile}: ${pairs.length} stills: node scripts/effect-lab.mjs --pairs ${manifestFile} --url http://localhost:<vite port>, then rerun this script.`);
}

if (args.includes('--uncovered')) {
  console.log(plan.uncovered.length
    ? `Without a page (${plan.uncovered.length}): ${plan.uncovered.map((effect) => effect.id).join(', ')}`
    : 'Every visible effect has a page.');
}
for (const note of notes) console.warn(note);
const entries = plan.catalog.effects;
console.log(`${entries.length} effects in ${snapshot.groups.length} picker groups; ${entries.filter((entry) => entry.page).length} effect pages (${entries.filter((entry) => entry.basic).length} basic), ${entries.filter((entry) => entry.thumb).length} thumbnails.`);
if (check) {
  if (changes.length) {
    console.error(`Out of date: ${changes.join(', ')}. Run node scripts/effect-docs.mjs.`);
    process.exitCode = 1;
  } else {
    console.log('Effect docs are current.');
  }
} else {
  console.log(changes.length ? `Wrote ${changes.join(', ')}.` : 'Nothing to write.');
}
