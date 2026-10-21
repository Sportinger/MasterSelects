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
