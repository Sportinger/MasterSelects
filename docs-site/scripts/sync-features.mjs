// Sync docs/Features into the Starlight content collection.
//
// docs/Features stays the single source of truth (edited alongside the code); this
// script renders it for the /docs site:
//   - pages: docs/Features/*.md → /docs/features/<page>/, guides/*.md → /docs/guides/<slug>/,
//     effects/<id>.md → /docs/effects/<id>/, effects/index.md → /docs/effects/,
//     README.md (the part above "## Documentation Index") → /docs/getting-started/overview/;
//   - the sidebar from the "## Documentation Index" of README.md (lib/featureIndex.mjs),
//     including the effect subgroups of the app's picker groups and the unpublished pages;
//   - links resolved relative to each page, "Back to …" lines dropped, galleries and clips
//     expanded (lib/convertPage.mjs); shared assets copied to public/assets;
//   - redirects from docs/Features/redirects.json (lib/redirects.mjs).
// Everything it writes is generated and untracked: src/content/docs/{features,guides,effects}/,
// src/content/docs/getting-started/overview.md, src/generated/ and public/assets/.
//
// Usage: node scripts/sync-features.mjs [--build] [--source-ref <ref>]   (from docs-site/)
//   --build              always clear the Astro content cache (production builds)
//   --source-ref <ref>   read docs/Features from a Git ref instead of the working tree
// It warns about links to missing pages or headings, pictures without alt text and assets over
// their byte budget; warnings never fail the sync.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { convertPage, preparePage, titleOf } from './lib/convertPage.mjs';
import { loadEffectCatalog } from './lib/effectCatalog.mjs';
import { buildSidebar, countSidebarPages, effectGroupIndex, readIndexSections } from './lib/featureIndex.mjs';
import { assetBudgetIssues, pageBudgetIssues } from './lib/media.mjs';
import { buildAnchorRedirects, buildRedirects } from './lib/redirects.mjs';
import { PAGE_FOLDERS, contentFile, pageSlug } from './lib/routes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, '..');
const repoRoot = path.resolve(siteDir, '..');
const featuresDir = path.join(repoRoot, 'docs', 'Features');
const contentDir = path.join(siteDir, 'src', 'content', 'docs');
const generatedDir = path.join(siteDir, 'src', 'generated');
const astroCacheDir = path.join(siteDir, '.astro');
const featurePath = 'docs/Features';
const groupsPath = 'src/effects/effectCatalogGroups.ts';
const forBuild = process.argv.includes('--build');
const sourceRefFlag = process.argv.indexOf('--source-ref');
const sourceRef = sourceRefFlag >= 0 ? process.argv[sourceRefFlag + 1] : undefined;
// Folders and files the sync owns inside src/content/docs (everything else there is hand-written).
const generatedContent = ['features', ...PAGE_FOLDERS];
const overviewFile = 'getting-started/overview.md';

if (sourceRefFlag >= 0 && !sourceRef) {
  throw new Error('--source-ref requires a Git ref, for example HEAD.');
}

function gitOutput(args, options = {}) {
  return execFileSync('git', args, { cwd: repoRoot, maxBuffer: 64 * 1024 * 1024, ...options });
}

const gitFiles = sourceRef
  ? gitOutput(['ls-tree', '-r', '--name-only', sourceRef, '--', featurePath], { encoding: 'utf8' }).split(/\r?\n/u).filter(Boolean)
      .map((name) => name.slice(featurePath.length + 1))
  : [];
function listWorkingTree() {
  const files = fs.readdirSync(featuresDir).filter((name) => name.endsWith('.md'));
  for (const folder of PAGE_FOLDERS) {
    const dir = path.join(featuresDir, folder);
    if (fs.existsSync(dir)) files.push(...fs.readdirSync(dir).filter((name) => name.endsWith('.md')).map((name) => `${folder}/${name}`));
  }
  return files;
}
// Source pages, relative to docs/Features: README.md, X.md, guides/x.md, effects/x.md.
const sourceFiles = (sourceRef ? gitFiles : listWorkingTree()).filter((file) => pageSlug(file) !== undefined).toSorted();

/** A docs/Features file (relative path) as text or bytes, or undefined when it does not exist. */
function readFeatureFile(relativePath, encoding) {
  try {
    if (!sourceRef) return fs.readFileSync(path.join(featuresDir, relativePath), encoding);
    return gitOutput(['show', `${sourceRef}:${featurePath}/${relativePath}`], { encoding, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}
function readRepoFile(relativePath) {
  try {
    if (!sourceRef) return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
    return gitOutput(['show', `${sourceRef}:${relativePath}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return undefined;
  }
}

const warnings = [];
const infos = [];
const report = ({ level, text }) => (level === 'info' ? infos : warnings).push(text);

// A running `astro dev` (recorded in .astro/dev.json) imports generated modules
// from this cache and restarts with an empty content collection when its
// settings vanish: keep the cache only while an astro dev server of this very
// site runs. A stale record whose PID now belongs to another process does not
// count, and builds (--build) always start from a clean cache.
async function devServerRunning() {
  let pid, url;
  try { ({ pid, url } = JSON.parse(fs.readFileSync(path.join(astroCacheDir, 'dev.json'), 'utf8'))); } catch { return false; }
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (fs.existsSync('/proc')) {
    try {
      const commandLine = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
      const cwd = fs.realpathSync(`/proc/${pid}/cwd`);
      return commandLine.some((part) => /astro(\.mjs)?$/.test(part)) && commandLine.includes('dev') && cwd === fs.realpathSync(siteDir);
    } catch { return false; }
  }
  // Without /proc (Windows, macOS) a recorded PID may belong to another process by now: only a
  // dev server that answers on its recorded address counts as running.
  if (typeof url !== 'string') return false;
  try { await fetch(url, { signal: AbortSignal.timeout(1500) }); return true; } catch { return false; }
}
const devServer = !forBuild && await devServerRunning();
if (!devServer) fs.rmSync(astroCacheDir, { recursive: true, force: true });

// Pages are updated in place: a running `astro dev` watches these files, and
// removing the whole folder would end those watches (the site then keeps
// serving the previous text). Unchanged files are not rewritten.
function writeIfChanged(file, content) {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return true;
}

// Hand-written site pages (Welcome, the home page) can be listed in the index too.
function handWrittenSitePages() {
  const slugs = new Set();
  const walk = (dir, prefix) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!prefix && generatedContent.includes(entry.name)) continue;
        walk(path.join(dir, entry.name), relative);
      } else if (/\.mdx?$/u.test(entry.name) && relative !== overviewFile) {
        const slug = relative.replace(/\.mdx?$/u, '');
        slugs.add(slug === 'index' ? '' : slug.replace(/\/index$/u, ''));
      }
    }
  };
  walk(contentDir, '');
  return slugs;
}

const sources = new Map(sourceFiles.map((file) => [file, readFeatureFile(file, 'utf8')]));
const titles = new Map([...sources].map(([file, text]) => [file, titleOf(text)]));

// Effects: the picker groups (src/effects/effectCatalogGroups.ts) plus the generated catalog.
let catalogJson;
const catalogText = readFeatureFile('effects/catalog.json', 'utf8');
if (catalogText) {
  try { catalogJson = JSON.parse(catalogText); } catch (error) { report({ level: 'warn', text: `Effects: docs/Features/effects/catalog.json is not valid JSON (${error.message}); ignored.` }); }
}
const catalog = loadEffectCatalog({ catalog: catalogJson, groupsSource: readRepoFile(groupsPath) });
catalog.notes.forEach(report);
const effectNames = new Map(catalog.groups.flatMap((group) => group.effects)
  .map((id) => [id, catalog.effects.get(id)?.name]).filter(([, name]) => name));

// Sidebar groups come from the "## Documentation Index" of docs/Features/README.md.
const index = sources.has('README.md') ? readIndexSections(sources.get('README.md')) : { sections: [], notes: [] };
index.notes.forEach(report);
if (!index.sections.length) report({ level: 'warn', text: 'Sidebar: docs/Features/README.md has no "## Documentation Index" sections; every page goes into "More".' });
const sitePages = handWrittenSitePages();
const { sidebar, unpublished, notes: sidebarNotes } = buildSidebar({
  sections: index.sections, pages: sourceFiles, sitePages, effectGroups: catalog.groups, effectNames,
});
sidebarNotes.forEach(report);
const effectIndex = effectGroupIndex(index.sections);

// Pass 1: every published page alone (back-links, galleries, anchors).
const published = sourceFiles.filter((file) => !unpublished.has(file));
const assetCache = new Map();
const readAsset = (file) => {
  if (!assetCache.has(file)) assetCache.set(file, readFeatureFile(file));
  return assetCache.get(file);
};
const checkedAssets = new Map();
const prepared = new Map(published.map((file) => [file, preparePage(sources.get(file), {
  overview: file === 'README.md',
  title: file === 'README.md' ? 'Overview' : undefined,
  file,
  catalog,
  effectIndex,
  hasPage: (page) => published.includes(page),
  pageTitle: (page) => titles.get(page),
  asset: readAsset,
  checkAsset: (asset, bytes, options) => checkAsset(asset, bytes, options, file),
  warn: (text) => report({ level: 'warn', text: `${file}: ${text}` }),
})]));
// Every asset a page uses, for the page budget (an asset counts once per page; the small gallery
// thumbnails of the catalog pages have their own budget per file).
const pageAssets = new Map();
function checkAsset(asset, bytes, options = {}, page) {
  if (bytes && page && !options.thumb) {
    if (!pageAssets.has(page)) pageAssets.set(page, new Map());
    pageAssets.get(page).set(asset, bytes.length);
  }
  if (!bytes || checkedAssets.has(asset)) return;
  checkedAssets.set(asset, page);
  for (const issue of assetBudgetIssues(asset, bytes, options)) report({ level: 'warn', text: `Budget: ${asset} is ${issue}; used on ${page}.` });
}

// Pass 2: links between pages, media, then write.
const written = new Set();
for (const file of published) {
  const text = convertPage(prepared.get(file), {
    file,
    published: (page) => pageSlug(page),
    exists: (page) => sources.has(page),
    unpublished: (page) => unpublished.has(page),
    anchorsOf: (page) => prepared.get(page)?.anchors,
    asset: readAsset,
    checkAsset: (asset, bytes, options) => checkAsset(asset, bytes, options, file),
    warn: (message) => report({ level: 'warn', text: message }),
  });
  const out = file === 'README.md' ? overviewFile : contentFile(pageSlug(file));
  writeIfChanged(path.join(contentDir, out), text);
  written.add(out);
}
for (const [page, assets] of pageAssets) {
  for (const issue of pageBudgetIssues(assets)) report({ level: 'warn', text: `Budget: ${page}: ${issue}.` });
}
let removedPages = 0;
for (const folder of generatedContent) {
  const dir = path.join(contentDir, folder);
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const relative = path.relative(contentDir, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/');
    if (written.has(relative)) continue;
    fs.rmSync(path.join(contentDir, relative), { force: true });
    removedPages += 1;
  }
  if (folder !== 'features' && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
}

// The dev server restarts for the new sidebar at the same moment and misses the deletions.
if (devServer && removedPages) report({ level: 'warn', text: `${removedPages} page(s) were removed: restart the running astro dev, which keeps serving them until then.` });

// Shared assets (pictures, clips, posters, captions) move into the site's public/ folder, in place like the
// pages: a running `astro dev` (Vite) watches public/, and a removed and recreated folder drops out of that
// watch, so the server answered 404 for every asset until it was restarted. Unchanged files stay untouched.
/** Files under `base`/assets, as assets/… paths. */
const listAssets = (base) => (fs.existsSync(path.join(base, 'assets')) ? fs.readdirSync(path.join(base, 'assets'), { recursive: true, withFileTypes: true })
  .filter((entry) => entry.isFile())
  .map((entry) => path.relative(base, path.join(entry.parentPath ?? entry.path, entry.name)).split(path.sep).join('/')) : []);
const assetFiles = sourceRef ? gitFiles.filter((name) => name.startsWith('assets/')) : listAssets(featuresDir);
let assetsWritten = 0;
let assetsRemoved = 0;
if (assetFiles.length) {
  const wanted = new Set(assetFiles);
  for (const relativePath of assetFiles) {
    const destination = path.join(siteDir, 'public', relativePath);
    const content = sourceRef ? readAsset(relativePath) : fs.readFileSync(path.join(featuresDir, relativePath));
    if (fs.existsSync(destination) && fs.statSync(destination).size === content.length && fs.readFileSync(destination).equals(content)) continue;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    assetsWritten += 1;
  }
  for (const stale of listAssets(path.join(siteDir, 'public')).filter((file) => !wanted.has(file))) {
    fs.rmSync(path.join(siteDir, 'public', stale), { force: true });
    assetsRemoved += 1;
  }
}

// Redirects for published URLs that moved; astro.config.mjs reads src/generated/redirects.json.
let redirectEntries = {};
let anchorEntries = {};
const redirectText = readFeatureFile('redirects.json', 'utf8');
if (redirectText) {
  try { ({ redirects: redirectEntries = {}, anchors: anchorEntries = {} } = JSON.parse(redirectText)); } catch (error) { report({ level: 'warn', text: `Redirects: docs/Features/redirects.json is not valid JSON (${error.message}); no redirects.` }); }
}
const routes = new Set([...published.map((file) => pageSlug(file)), ...sitePages]);
const anchorsBySlug = new Map(published.map((file) => [pageSlug(file), prepared.get(file).anchors]));
const redirects = buildRedirects(redirectEntries, routes, (slug) => anchorsBySlug.get(slug));
redirects.notes.forEach(report);
const anchorRedirects = buildAnchorRedirects(anchorEntries, routes, (slug) => anchorsBySlug.get(slug));
anchorRedirects.notes.forEach(report);

// Rewrite generated JSON only on change: a running `astro dev` restarts when these files change.
const configChanged = [
  writeIfChanged(path.join(generatedDir, 'sidebar.json'), `${JSON.stringify(sidebar, null, 2)}\n`),
  writeIfChanged(path.join(generatedDir, 'redirects.json'), `${JSON.stringify(redirects.redirects, null, 2)}\n`),
  writeIfChanged(path.join(generatedDir, 'anchor-redirects.json'), `${JSON.stringify(anchorRedirects.anchors, null, 2)}\n`),
].some(Boolean);
// astro.config.mjs reads these files: a running astro dev restarts for them, and after that restart it no longer
// reloads edited pages (it keeps serving their old text, sometimes a 500) until it is started again.
if (devServer && configChanged) report({ level: 'warn', text: 'The sidebar or redirects changed: restart the running astro dev (npx astro dev stop, then start it), which no longer reloads edited pages after its own config restart.' });

// A figure that stays as written is checked again by the general pass: report each problem once.
const uniqueWarnings = [...new Set(warnings)];
for (const text of uniqueWarnings) console.warn(text);
for (const text of infos) console.log(text);
const sourceLabel = sourceRef ? `Git ref ${sourceRef}` : 'working tree';
console.log(`Sidebar: ${sidebar.length} groups, ${countSidebarPages(sidebar)} entries; ${unpublished.size} pages unpublished. Effect groups from ${catalog.source}.`);
console.log(`Converted ${published.length - 1} pages + overview from ${sourceLabel}; ${redirects.active} redirects, ${anchorRedirects.count} anchor redirects; assets ${assetFiles.length ? `${assetFiles.length} (${assetsWritten} written, ${assetsRemoved} removed)` : 'not found'}; ${uniqueWarnings.length} warnings.`);
