// docs/Features/redirects.json → Astro `redirects` for published URLs that moved.
//
//   { "redirects": { "/docs/features/time-stack/": "/docs/effects/time-stack/" } }
//
// Both sides are public URLs under /docs. A redirect waits (and is reported) while its old
// page is still published, and is dropped with a warning when its target page does not exist.
// Astro takes the old path relative to the /docs base and the target as written.

import { SITE_BASE } from './routes.mjs';

const routeOf = (url) => url.split('#')[0].replace(/^\/docs(?=\/|$)/u, '').replace(/^\/+|\/+$/gu, '');

/**
 * entries: the "redirects" object; routes: Set of published slugs ('features/timeline', 'effects', …);
 * anchorsOf(slug): Set of the anchors of a published page (optional, checks "#…" targets).
 * Returns { redirects (for astro.config), active, waiting, notes }.
 */
export function buildRedirects(entries, routes, anchorsOf = () => undefined) {
  const redirects = {};
  const notes = [];
  let waiting = 0;
  for (const [from, to] of Object.entries(entries ?? {})) {
    if (typeof to !== 'string' || !from.startsWith(`${SITE_BASE}/`) || !to.startsWith(`${SITE_BASE}/`)) {
      notes.push({ level: 'warn', text: `Redirects: "${from}" → "${to}" must map one ${SITE_BASE}/… URL to another; skipped.` });
      continue;
    }
    const source = routeOf(from);
    if (routes.has(source)) {
      waiting += 1;
      continue;
    }
    if (!routes.has(routeOf(to))) {
      notes.push({ level: 'warn', text: `Redirects: "${from}" points to ${to}, which is no published page; skipped.` });
      continue;
    }
    const anchor = to.split('#')[1];
    if (anchor && anchorsOf(routeOf(to)) && !anchorsOf(routeOf(to)).has(decodeURIComponent(anchor))) {
      notes.push({ level: 'warn', text: `Redirects: "${from}" points to #${anchor}, which ${to.split('#')[0]} does not have; the redirect lands at the top of the page.` });
    }
    redirects[`/${source}`] = to;
  }
  const active = Object.keys(redirects).length;
  if (waiting) notes.push({ level: 'info', text: `Redirects: ${waiting} wait until their old page is gone.` });
  return { redirects, active, waiting, notes };
}

/**
 * Sections that left a page which stays published: { "<page URL>": { "<old anchor>": "<new URL>" } }.
 * A visit with that #anchor is sent on by a small script in the page head (astro.config.mjs).
 * Reported: a page that is not published, an anchor the page still has (the redirect would hide
 * it), and a target that is no published page or lacks its anchor.
 * Returns { anchors (for src/generated/anchor-redirects.json), count, notes }.
 */
export function buildAnchorRedirects(entries, routes, anchorsOf = () => undefined) {
  const anchors = {};
  const notes = [];
  let count = 0;
  for (const [page, map] of Object.entries(entries ?? {})) {
    const route = routeOf(page);
    if (!page.startsWith(`${SITE_BASE}/`) || !routes.has(route)) {
      notes.push({ level: 'warn', text: `Anchor redirects: ${page} is no published page; its ${Object.keys(map ?? {}).length} anchors are skipped.` });
      continue;
    }
    for (const [anchor, to] of Object.entries(map ?? {})) {
      if (anchorsOf(route)?.has(anchor)) {
        notes.push({ level: 'warn', text: `Anchor redirects: ${page}#${anchor} still exists on the page; not redirected.` });
        continue;
      }
      if (typeof to !== 'string' || !to.startsWith(`${SITE_BASE}/`) || !routes.has(routeOf(to))) {
        notes.push({ level: 'warn', text: `Anchor redirects: ${page}#${anchor} points to ${to}, which is no published page; skipped.` });
        continue;
      }
      const targetAnchor = to.split('#')[1];
      if (targetAnchor && anchorsOf(routeOf(to)) && !anchorsOf(routeOf(to)).has(decodeURIComponent(targetAnchor))) {
        notes.push({ level: 'warn', text: `Anchor redirects: ${page}#${anchor} points to #${targetAnchor}, which ${to.split('#')[0]} does not have.` });
      }
      (anchors[`${SITE_BASE}/${route}/`] ??= {})[anchor] = to;
      count += 1;
    }
  }
  return { anchors, count, notes };
}
