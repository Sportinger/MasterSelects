// Turns one docs/Features Markdown page into Starlight content.
//
// Pass 1 (preparePage) works on the page alone: it drops the repo-internal "Back to …"
// lines, expands <!-- docs-gallery: … --> cards and collects the page's anchors, so links
// between pages can be checked. Pass 2 (convertPage) rewrites links and media for the site:
// pages → /docs/<route>/, shared assets → /docs/assets/…, pictures → full-size links,
// clips → reduced-motion-aware <video>. Code blocks and inline code are left untouched.

import { Slugger, slug } from './slug.mjs';
import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, imageSize, mp4Info } from './media.mjs';
import { SITE_BASE, isExternal, pageSlug, resolveFrom, routeUrl } from './routes.mjs';

const FENCE = /^ {0,3}(`{3,}|~{3,})/u;
const INLINE_CODE = /(``[^\n]*?``|`[^`\n]*`)/u;

/** Apply `transform` to the prose of a page: fenced blocks and inline code stay as written. */
export function mapProse(markdown, transform) {
  const lines = markdown.split('\n');
  const out = [];
  let prose = [];
  let fence;
  const flush = () => {
    if (!prose.length) return;
    const text = prose.join('\n').split(INLINE_CODE).map((part, index) => (index % 2 ? part : transform(part))).join('');
    out.push(text);
    prose = [];
  };
  for (const line of lines) {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      out.push(line);
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length)) fence = undefined;
    } else if (marker) {
      flush();
      fence = marker;
      out.push(line);
    } else {
      prose.push(line);
    }
  }
  flush();
  return out.join('\n');
}

/** Lines outside fenced code blocks, with their index. */
function proseLines(markdown) {
  const result = [];
  let fence;
  markdown.split('\n').forEach((line, index) => {
    const marker = line.match(FENCE)?.[1];
    if (fence) {
      if (marker && marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    } else if (marker) {
      fence = marker;
    } else {
      result.push({ line, index });
    }
  });
  return result;
}

const BACK_LINK = /\[(?:←|<-|&larr;)?\s*Back to [^\]]*\]\([^)\s]*README\.md\)[ \t]*(?:[|·][ \t]*)?/iu;
const BACK_LINKS = new RegExp(BACK_LINK.source, 'giu');

/** Remove every "[← Back to …](…README.md)" link; a line left empty goes with its blank line. */
export function stripBackLinks(markdown) {
  const lines = markdown.split('\n');
  const drop = new Set();
  for (const { line, index } of proseLines(markdown)) {
    if (!BACK_LINK.test(line)) continue;
    const rest = line.replace(BACK_LINKS, '').trim();
    if (rest) lines[index] = rest;
    else {
      drop.add(index);
      if (lines[index + 1]?.trim() === '') drop.add(index + 1);
    }
  }
  return lines.filter((_, index) => !drop.has(index)).join('\n');
}

/** Visible text of a Markdown heading, as the site renders it before slugging. */
export function headingText(source) {
  return source
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/<[^>]+>/gu, '')
    .replace(/`([^`]*)`/gu, '$1')
    .replace(/(\*\*|__)(.+?)\1/gu, '$2')
    .replace(/(^|[^\w*])\*(?!\s)(.+?)\*(?!\w)/gu, '$1$2')
    .replace(/\s+#+\s*$/u, '')
    .trim();
}

/** The first H1 outside code: { text, index } or undefined. */
function titleLine(markdown) {
  for (const { line, index } of proseLines(markdown)) {
    const match = line.match(/^#\s+(.+?)\s*$/u);
    if (match) return { text: match[1], index };
  }
  return undefined;
}

/** Title of a page: its first H1 outside code, or undefined. */
export function titleOf(markdown) {
  return titleLine(markdown.replace(/\r\n/gu, '\n'))?.text;
}

/** Anchors a page offers: heading slugs (github-slugger rules, as Starlight; lib/slug.mjs) plus HTML ids. */
export function pageAnchors(markdown, { skipTitle = true } = {}) {
  const slugger = new Slugger();
  const anchors = new Set();
  const title = skipTitle ? titleLine(markdown) : undefined;
  for (const { line, index } of proseLines(markdown)) {
    if (index === title?.index) continue;
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*$/u);
    if (heading) anchors.add(slugger.slug(headingText(heading[1])));
    for (const match of line.matchAll(/\sid="([^"]+)"/gu)) anchors.add(match[1]);
  }
  return anchors;
}

const escapeHtml = (value) => String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const assetUrl = (file) => `${SITE_BASE}/${file}`;

/**
 * Cards for <!-- docs-gallery: <group-id>[+<group-id>…] | all -->.
 * ctx: { catalog (loadEffectCatalog), hasPage(file), asset(file), warn(text), takenIds: Set }.
 * A card links to effects/<id>.md when that page exists, shows the catalog thumbnail when
 * the file exists, and keeps the effect's old heading slug as its id (unless the page uses it).
 */
export function galleryHtml(spec, ctx) {
  const { catalog } = ctx;
  const groups = spec === 'all'
    ? catalog.groups
    : spec.split('+').map((id) => catalog.groups.find((group) => group.id === id) ?? (ctx.warn(`Gallery: unknown effect group "${id}"; left out.`), undefined)).filter(Boolean);
  const list = (ids, label) => {
    const cards = ids.map((id) => {
      const entry = catalog.effects.get(id) ?? {};
      const page = `effects/${id}.md`;
      const name = entry.name ?? ctx.pageTitle?.(page) ?? id;
      const anchor = entry.anchor ?? slug(name);
      const idAttribute = ctx.takenIds.has(anchor) ? '' : ` id="${escapeHtml(anchor)}"`;
      ctx.takenIds.add(anchor);
      let thumb = '<span class="docs-gallery-thumb docs-gallery-thumb--empty" aria-hidden="true"></span>';
      if (entry.thumb) {
        const bytes = ctx.asset(entry.thumb);
        if (bytes) {
          ctx.checkAsset?.(entry.thumb, bytes, { thumb: true });
          const size = imageSize(bytes);
          const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
          thumb = `<img class="docs-gallery-thumb" src="${assetUrl(entry.thumb)}" alt=""${dimensions} loading="lazy" decoding="async">`;
        } else {
          ctx.warn(`Gallery: the thumbnail ${entry.thumb} of "${id}" does not exist; card shown without a picture.`);
        }
      }
      const text = entry.description ? `<span class="docs-gallery-text">${escapeHtml(entry.description)}</span>` : '';
      const body = `${thumb}<span class="docs-gallery-name">${escapeHtml(name)}</span>${text}`;
      const card = ctx.hasPage(page)
        ? `<a class="docs-gallery-card" href="${routeUrl(pageSlug(page))}">${body}</a>`
        : `<span class="docs-gallery-card docs-gallery-card--soon">${body}</span>`;
      return `<li${idAttribute}>${card}</li>`;
    });
    return `<ul class="docs-gallery not-content" aria-label="${escapeHtml(label)}">\n${cards.join('\n')}\n</ul>`;
  };
  if (spec !== 'all') return list(groups.flatMap((group) => group.effects), groups.map((group) => group.label).join(' & '));
  return groups.filter((group) => group.effects.length).map((group) => `## ${group.label}\n\n${list(group.effects, group.label)}`).join('\n\n');
}

/**
 * Pass 1. Returns { body, title, anchors } for a page; `overview` keeps only the part
 * above "## Documentation Index" (README.md).
 */
export function preparePage(markdown, { overview = false, title, ...ctx } = {}) {
  let body = stripBackLinks(markdown.replace(/\r\n/gu, '\n'));
  if (overview) {
    const index = body.search(/^##\s+Documentation Index\s*$/mu);
    if (index >= 0) body = body.slice(0, index).replace(/\n-{3,}\s*$/u, '').trimEnd() + '\n';
  }
  const h1 = titleLine(body);
  const pageTitle = title ?? h1?.text ?? 'Untitled';
  if (h1) {
    const lines = body.split('\n');
    lines.splice(h1.index, lines[h1.index + 1]?.trim() === '' ? 2 : 1);
    body = lines.join('\n');
  }
  const headingAnchors = pageAnchors(body, { skipTitle: false });
  if (ctx.catalog && /<!--\s*docs-gallery:/u.test(body)) {
    const takenIds = new Set(headingAnchors);
    body = mapProse(body, (text) => text.replace(/^[ \t]*<!--\s*docs-gallery:\s*([\w+-]+)\s*-->[ \t]*$/gmu, (_, spec) => galleryHtml(spec, { ...ctx, takenIds })));
  }
  return { body, title: pageTitle, anchors: pageAnchors(body, { skipTitle: false }) };
}

/**
 * Pass 2. ctx: { file, published(file) → slug | undefined, exists(file), unpublished(file),
 *   anchorsOf(file) → Set | undefined, asset(file) → bytes | undefined,
 *   checkAsset(file, bytes, options), warn(text) }.
 * Returns the Starlight file text (frontmatter + body).
 */
export function convertPage({ body, title }, ctx) {
  let pictures = 0;
  const checkAnchor = (file, anchor, label) => {
    if (!anchor) return;
    const anchors = ctx.anchorsOf(file);
    if (anchors && !anchors.has(decodeURIComponent(anchor))) ctx.warn(`${ctx.file}: the link "${label}" points to #${anchor}, which ${file === ctx.file ? 'this page' : file} does not have.`);
  };

  // A relative target: { url } for a site route or asset, { text: true } for "keep the label only".
  const resolveTarget = (target, label) => {
    if (target.startsWith('#')) {
      checkAnchor(ctx.file, target.slice(1), label);
      return { url: target };
    }
    if (isExternal(target) || target.startsWith('/')) return { url: target };
    const [rawPath, anchor = ''] = target.split('#');
    const suffix = anchor ? `#${anchor}` : '';
    let resolved = resolveFrom(ctx.file, rawPath);
    if (resolved.startsWith('assets/') || /^(?:\.\/)?assets\//u.test(rawPath)) {
      let bytes = ctx.asset(resolved);
      if (!bytes && /^(?:\.\/)?assets\//u.test(rawPath) && ctx.file.includes('/')) {
        const fromRoot = rawPath.replace(/^\.\//u, '');
        bytes = ctx.asset(fromRoot);
        if (bytes) {
          ctx.warn(`${ctx.file}: "${rawPath}" is resolved from docs/Features; write ../${fromRoot} so the link works on GitHub too.`);
          resolved = fromRoot;
        }
      }
      if (!bytes) {
        ctx.warn(`${ctx.file}: the file ${resolved} (from "${label}") does not exist.`);
        return { url: assetUrl(resolved) + suffix, missing: true };
      }
      ctx.checkAsset(resolved, bytes);
      return { url: assetUrl(resolved) + suffix, asset: resolved, bytes };
    }
    if (pageSlug(resolved) !== undefined) {
      if (!ctx.exists(resolved)) {
        ctx.warn(`${ctx.file}: the link "${label}" points to ${resolved}, which does not exist.`);
        return { text: true };
      }
      if (ctx.unpublished(resolved)) return { text: true };
      checkAnchor(resolved, anchor, label);
      return { url: routeUrl(ctx.published(resolved)) + suffix };
    }
    // Repository-internal destinations (source files, the project README) are not
    // public documentation routes: keep their readable label.
    return { text: true };
  };

  const videoHtml = (resolved, alt) => {
    const stem = resolved.replace(VIDEO_EXTENSIONS, '');
    const sources = ['webm', 'mp4'].map((ext) => `${stem}.${ext}`).filter((file) => ctx.asset(file));
    const poster = ['webp', 'jpg', 'png'].map((ext) => `${stem}.${ext}`).find((file) => ctx.asset(file));
    const track = ctx.asset(`${stem}.vtt`) ? `<track kind="captions" srclang="en" label="English" src="${assetUrl(`${stem}.vtt`)}">` : '';
    for (const file of sources) if (file !== resolved) ctx.checkAsset(file, ctx.asset(file));
    if (!poster) ctx.warn(`${ctx.file}: the clip ${resolved} has no poster (${stem}.webp); viewers who prefer reduced motion see an empty frame.`);
    const size = (poster && imageSize(ctx.asset(poster))) ?? mp4Info(ctx.asset(`${stem}.mp4`));
    const dimensions = size?.width ? ` width="${size.width}" height="${size.height}"` : '';
    const posterAttribute = poster ? ` poster="${assetUrl(poster)}"` : '';
    const list = sources.map((file) => `<source src="${assetUrl(file)}" type="video/${file.split('.').pop()}">`).join('');
    return `<video class="docs-clip-video"${posterAttribute}${dimensions} muted loop playsinline controls preload="none" data-docs-autoplay aria-label="${escapeHtml(alt)}">${list}${track}</video>`;
  };

  const text = mapProse(body, (prose) => {
    let out = prose.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu, (full, imagePrefix, label, target) => {
      if (imagePrefix && !label.trim()) ctx.warn(`${ctx.file}: the picture ${target} has no alt text.`);
      const result = resolveTarget(target, label || target);
      if (result.text && imagePrefix) ctx.warn(`${ctx.file}: the picture ${target} lies outside docs/Features; only its alt text is shown.`);
      if (result.text) return label;
      if (!result.asset && !result.missing) return `${imagePrefix}[${label}](${result.url})`;
      if (!imagePrefix) return `[${label}](${result.url})`;
      if (result.asset && VIDEO_EXTENSIONS.test(result.asset)) return videoHtml(result.asset, label);
      const size = result.bytes && IMAGE_EXTENSIONS.test(result.url) ? imageSize(result.bytes) : undefined;
      const dimensions = size ? ` width="${size.width}" height="${size.height}"` : '';
      const loading = pictures++ ? ' loading="lazy"' : '';
      return `<a class="docs-shot-zoom" href="${result.url}" title="Open the full-size picture"><img src="${result.url}" alt="${escapeHtml(label)}"${dimensions}${loading} decoding="async"></a>`;
    });
    // Raw HTML (figures, clips from scripts/doc-clip.mjs): relative src/poster/href too.
    out = out.replace(/<[a-z][a-z0-9-]*\s[^>]*>/giu, (tag) => tag.replace(/(\s)(src|poster|href)="([^"]+)"/giu, (full, space, attribute, target) => {
      if (isExternal(target) || target.startsWith('/') || target.startsWith('#') || target.startsWith('data:')) return full;
      const result = resolveTarget(target, target);
      if (result.text) {
        ctx.warn(`${ctx.file}: ${attribute}="${target}" points to a file the site does not publish; attribute dropped.`);
        return '';
      }
      return `${space}${attribute}="${result.url}"`;
    }));
    // Clips: muted, inline, with controls until the site script takes over playback.
    out = out.replace(/<video\b([^>]*)>/giu, (full, attributes) => {
      let list = attributes;
      // Videos from the Markdown shortcut above are complete and already checked.
      const authored = !/\bclass="[^"]*\bdocs-clip-video\b/u.test(list);
      if (authored) {
        list = /\bclass="/u.test(list) ? list.replace(/\bclass="/u, 'class="docs-clip-video ') : ` class="docs-clip-video"${list}`;
      }
      list = list.replace(/\sautoplay(?:="[^"]*")?(?=\s|$)/u, ' data-docs-autoplay');
      for (const flag of ['muted', 'playsinline', 'controls']) if (!new RegExp(`\\s${flag}\\b`, 'u').test(list)) list += ` ${flag}`;
      // Without width/height the clip takes its poster's size, so the page does not shift when it loads.
      const posterUrl = list.match(/\sposter="\/docs\/(assets\/[^"]+)"/u)?.[1];
      if (authored && posterUrl && !(/\swidth="/u.test(list) && /\sheight="/u.test(list))) {
        const size = imageSize(ctx.asset(posterUrl));
        if (size) list = `${list.replace(/\s(?:width|height)="[^"]*"/gu, '')} width="${size.width}" height="${size.height}"`;
        else ctx.warn(`${ctx.file}: a <video> has no width/height and no readable poster; the page shifts when it loads.`);
      }
      if (authored && !/\sposter="/u.test(list)) ctx.warn(`${ctx.file}: a <video> has no poster; viewers who prefer reduced motion see an empty frame.`);
      if (authored && !/\s(?:aria-label|title)="/u.test(list)) ctx.warn(`${ctx.file}: a <video> has no aria-label.`);
      return `<video${list.replace(/\s+$/u, '')}>`;
    });
    return out;
  });
  return `---\ntitle: ${JSON.stringify(title)}\n---\n\n${text.replace(/^\s*\n/u, '')}`;
}
