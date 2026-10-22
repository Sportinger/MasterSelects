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
//   node scripts/effect-docs.mjs --controls <id>       # print an effect's controls: the generated table, one paragraph
//                                                      # skeleton per control with its limits and default (for a
//                                                      # hand-written page) and its presets with their values
//
// The registry is TypeScript: it is loaded through Vite (no dev server, no config file, no browser).
// Rules for effect pages: docs/Features/Documentation-Site.md ("Effect pages").
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTROLS_END, CONTROLS_START, LAB_STILL_SKIP, controlDefault, controlsTable, effectAssets, isBasicPage, labPair, pageFile, planEffectDocs } from './effectDocsCatalog.mjs';
import { imageSize } from '../docs-site/scripts/lib/media.mjs';
import { makeThumb } from './docShotThumb.mjs';
import { recordFingerprints } from './docsMediaFingerprint.mjs';
import { loadEffectSnapshot } from './effectDocsRegistry.mjs';
import { thumbRecipe } from './docsMediaRecipes.mjs';
import { EFFECT_DOC_EXTRAS } from './effectDocsExtras.mjs';
import { controlParagraphSkeletons, handWrittenPageProblems, presetsVisual } from './effectDocsPageCheck.mjs';

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
/** Pixel size of a picture in docs/Features (basic stills keep their layout). */
const size = (file) => (exists(file) ? imageSize(fs.readFileSync(feature(file))) : undefined);
const listPages = () => (fs.existsSync(feature('effects'))
  ? fs.readdirSync(feature('effects')).filter((name) => name.endsWith('.md') && name !== 'index.md').map((name) => name.slice(0, -3)).toSorted()
  : []);

const snapshot = await loadEffectSnapshot(root);
const notes = [];

const controlsFor = option('--controls');
if (controlsFor !== undefined) {
  const effect = snapshot.effects.find((entry) => entry.id === controlsFor);
  if (!effect) throw new Error(`--controls: "${controlsFor}" is not an effect id.`);
  console.log(`${CONTROLS_START}\n${controlsTable(effect)}\n${CONTROLS_END}`);
  console.log(`\nParagraphs for a hand-written page (## Controls; keep each limits sentence as it is):\n\n${controlParagraphSkeletons(effect)}`);
  if (effect.presets.length) {
    const visual = presetsVisual(effect);
    console.log(`\nPresets (## Presets, one bold paragraph each; ${visual.label} ../${visual.file}: ${visual.command}):`);
    const shown = (key, value) => {
      const param = effect.params.find((entry) => entry.key === key);
      return param ? `${param.label} ${controlDefault({ ...param, default: value })}` : `${key} ${value}`;
    };
    for (const preset of effect.presets) console.log(`**${preset.name}** – ${Object.entries(preset.params).map(([key, value]) => shown(key, value)).join(', ')}`);
  }
  process.exit(0);
}

// Gallery thumbnails first (the catalog lists them): the effect half of the still, 400 x 250 WebP (smaller if needed).
if (args.includes('--thumbs') && !check) {
  const forceOption = option('--force');
  const forceIds = forceOption ? forceOption.split(',').map((item) => item.trim()).filter(Boolean) : undefined;
  const forced = (effect) => forceOption !== undefined && (!forceIds || forceIds.includes(effect.id) || forceIds.includes(effect.group));
  for (const effect of snapshot.effects) {
    const assets = effectAssets(effect.id);
    const source = [assets.still, assets.poster].find(exists);
    if (!source || (exists(assets.thumb) && !forced(effect))) continue;
    const thumb = EFFECT_DOC_EXTRAS[effect.id]?.thumb;
    if (thumb?.shot) { notes.push(`${assets.thumb}: made by node scripts/effect-lab.mjs --pairs ${thumb.shot} --only ${effect.id}; left alone.`); continue; }
    const bytes = await makeThumb({ source: feature(source), out: feature(assets.thumb), region: thumb?.region });
    recordFingerprints([thumbRecipe(effect.id, { source })]);
    console.log(`${assets.thumb}: ${bytes} bytes from ${source}`);
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
    : planEffectDocs(snapshot, { read, exists, size, pages: listPages() }).uncovered.map((effect) => effect.id);
}

const plan = planEffectDocs(snapshot, { read, exists, size, pages: listPages() }, { basic });
for (const id of plan.unknownPages) notes.push(`effects/${id}.md: "${id}" is not an effect id of the registry; the page is left alone.`);
for (const problem of plan.problems) notes.push(problem.text);
if (plan.problems.length) process.exitCode = 1;
// Hand-written pages: every control of the card and every preset described, with the current limits.
for (const id of listPages()) {
  const effect = snapshot.effects.find((entry) => entry.id === id);
  const text = read(pageFile(id));
  if (!effect || text === undefined || isBasicPage(text)) continue;
  const problems = handWrittenPageProblems(effect, text, { exists });
  for (const problem of problems) notes.push(`${pageFile(id)} ${problem}.`);
  if (problems.length) process.exitCode = 1;
}
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
    .map((effect) => labPair(effect, size(effectAssets(effect.id).still)));
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
