// Where each docs/Features source file is published on the /docs site.
//
// Source paths are relative to docs/Features and use forward slashes:
//   README.md            → getting-started/overview   (the part above "## Documentation Index")
//   Timeline.md          → features/timeline
//   guides/first-edit.md → guides/first-edit
//   effects/index.md     → effects
//   effects/glow.md      → effects/glow
// Hand-written Starlight pages (docs-site/src/content/docs/**) are linked from the
// index as ../../docs-site/src/content/docs/<path>.md(x).

import path from 'node:path';

export const SITE_BASE = '/docs';
export const PAGE_FOLDERS = ['guides', 'effects'];
const SITE_SOURCE_PREFIX = '../../docs-site/src/content/docs/';

/** Starlight slug of a docs/Features page, or undefined for a file the site does not render. */
export function pageSlug(file) {
  if (file === 'README.md') return 'getting-started/overview';
  const match = file.match(/^(?:(guides|effects)\/)?([^/]+)\.md$/u);
  if (!match) return undefined;
  const [, folder, name] = match;
  const base = name.toLowerCase();
  if (!folder) return `features/${base}`;
  if (folder === 'effects' && base === 'index') return 'effects';
  return `${folder}/${base}`;
}

/** Slug of a hand-written site page for an index link into docs-site/src/content/docs, else undefined. */
export function sitePageSlug(resolved) {
  if (!resolved.startsWith(SITE_SOURCE_PREFIX) || !/\.mdx?$/u.test(resolved)) return undefined;
  const rest = resolved.slice(SITE_SOURCE_PREFIX.length).replace(/\.mdx?$/u, '');
  return rest === 'index' ? '' : rest.replace(/\/index$/u, '');
}

/** Public URL of a page slug, with the trailing slash Starlight uses. */
export const routeUrl = (slug) => (slug ? `${SITE_BASE}/${slug}/` : `${SITE_BASE}/`);

/** File under src/content/docs that holds a generated page. */
export const contentFile = (slug) => (slug === 'effects' ? 'effects/index.md' : `${slug}.md`);

/** A link target relative to the docs/Features file that contains it, normalised to a source path. */
export function resolveFrom(fromFile, target) {
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), target));
}

export const isExternal = (target) => /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target);
