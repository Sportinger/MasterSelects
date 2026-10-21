// Compare sliders: <figure class="docs-shot docs-compare"> around one pair asset – the original
// and the effect at the same size side by side, without a gap (a WebP still, or an MP4 loop with
// its WebP poster). GitHub and the raw Markdown show the pair as it is, which still reads.
//
// The sync turns the figure into a stage of one half's size: the effect half below, the original
// half above it, clipped at a divider at 50 %. The box is reserved from the asset's size, so the
// page never shifts; without JavaScript it reads as a split picture. src/scripts/docsCompare.js
// makes the divider draggable and, for a loop, draws both halves of the one video into a canvas
// each, so original and effect stay frame-synchronous.

import { IMAGE_EXTENSIONS, VIDEO_EXTENSIONS, imageSize, mp4Info } from './media.mjs';

export const COMPARE_FIGURE = /^[ \t]*<figure\b([^>]*\bclass="[^"]*\bdocs-compare\b[^"]*"[^>]*)>([\s\S]*?)^[ \t]*<\/figure>[ \t]*$/gmu;
const MARKDOWN_MEDIA = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/u;
const VIDEO_TAG = /<video\b([^>]*)>(?:[\s\S]*?<\/video>)?/u;
// Halves narrower than 1:2 or wider than 2.5:1 are almost certainly not two frames of one view.
const HALF_ASPECT = { min: 0.5, max: 2.5 };

const escapeHtml = (value) => String(value).replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;');
const attribute = (attributes, name) => attributes.match(new RegExp(`\\s${name}="([^"]*)"`, 'u'))?.[1];

/** Problems of a compare pair of this pixel size (the whole asset), as short phrases. */
export function compareSizeIssues(size) {
  if (!size?.width || !size?.height) return ['has no readable size, so the slider cannot reserve its box'];
  const issues = [];
  if (size.width % 2) issues.push(`is ${size.width} px wide, an odd width: a compare pair is two halves of the same size`);
  const half = size.width / 2, aspect = half / size.height;
  if (aspect < HALF_ASPECT.min || aspect > HALF_ASPECT.max) {
    issues.push(`would show halves of ${half} × ${size.height} px (${aspect.toFixed(2)}:1): a compare pair is the original and the effect side by side, each a whole view`);
  }
  return issues;
}

/**
 * The stage HTML of one compare figure.
 *   media   { kind: 'image', url, alt, size } or { kind: 'video', sources: [{ url, type }], track, label, poster: { url, size } }
 *   before, after  the tags of the two halves ("Original", the effect name)
 *   lazy    load the picture lazily (every picture after a page's first)
 */
export function compareStageHtml({ media, before, after, lazy }) {
  const size = media.kind === 'image' ? media.size : media.poster.size;
  const picture = media.kind === 'image' ? media.url : media.poster.url;
  const img = (alt) => `<img src="${picture}" alt="${escapeHtml(alt)}" width="${size.width}" height="${size.height}"${lazy ? ' loading="lazy"' : ''} decoding="async" draggable="false">`;
  const tag = (text) => `<span class="docs-compare-tag" aria-hidden="true">${escapeHtml(text)}</span>`;
  // The loop's video lies under both halves: docsCompare.js draws its frames into them. It keeps no
  // poster of its own, so the halves' pictures stay lazy.
  const video = media.kind === 'video'
    ? `<video class="docs-clip-video docs-compare-video" width="${size.width}" height="${size.height}" muted loop playsinline preload="none" data-docs-autoplay aria-label="${escapeHtml(media.label)}">${media.sources.map((source) => `<source src="${source.url}" type="${source.type}">`).join('')}${media.track ?? ''}</video>\n`
    : '';
  return `<div class="docs-compare-stage not-content" style="aspect-ratio: ${size.width / 2} / ${size.height}" data-before="${escapeHtml(before)}" data-after="${escapeHtml(after)}">\n`
    + video
    + `<div class="docs-compare-after">${img(media.kind === 'image' ? media.alt : '')}${tag(after)}</div>\n`
    + `<div class="docs-compare-before">${img('')}${tag(before)}</div>\n`
    + '<span class="docs-compare-handle"></span>\n</div>';
}

/** `prose` cut into text (strings) and compare figures ({ text, attributes, inner }), in page order. */
export function splitCompareFigures(prose) {
  const parts = [];
  let last = 0;
  for (const match of prose.matchAll(COMPARE_FIGURE)) {
    parts.push(prose.slice(last, match.index), { text: match[0], attributes: match[1], inner: match[2] });
    last = match.index + match[0].length;
  }
  parts.push(prose.slice(last));
  return parts;
}

/**
 * The stage of one compare figure (from splitCompareFigures), or undefined when it cannot become one: it then
 * stays as written (and so shows its pair), with a warning.
 * ctx: { file, title (the page title, the default effect tag), resolve(target, label) → { url, asset, bytes, missing, text },
 *   asset(file) → bytes | undefined, checkAsset(file, bytes), assetUrl(file), nextPicture() → index of this picture
 *   on the page, warn(text) }.
 * Optional attributes on the figure: data-before (default "Original") and data-after (default: the page title).
 */
export function compareFigure({ attributes, inner }, ctx) {
  const warn = (text) => ctx.warn(`${ctx.file}: the compare figure ${text}`);
  const image = inner.match(MARKDOWN_MEDIA);
  const videoTag = inner.match(VIDEO_TAG);
  if (!image === !videoTag) {
    warn(image ? 'holds both a picture and a <video>; it needs exactly one pair asset.' : 'holds no picture or <video>; it needs one pair asset.');
    return undefined;
  }
  const media = pairMedia(image, videoTag, ctx, warn);
  if (!media) return undefined;
  const lazy = ctx.nextPicture() > 0;
  const before = attribute(attributes, 'data-before') ?? 'Original';
  const after = attribute(attributes, 'data-after') ?? ctx.title ?? 'Effect';
  const rest = inner.replace(image ? image[0] : videoTag[0], '').split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
  const open = attributes.replace(/\s(?:data-before|data-after)="[^"]*"/gu, '');
  return `<figure${open}>\n${compareStageHtml({ media, before, after, lazy })}${rest ? `\n${rest}` : ''}\n</figure>`;
}

/** The pair asset of a figure (its Markdown picture or clip, or its <video>) as stage media, checked; or undefined. */
function pairMedia(image, videoTag, ctx, warn) {
  const target = image ? image[2] : attribute(videoTag[1], 'src') ?? videoTag[0].match(/<source\b[^>]*\ssrc="([^"]+)"/u)?.[1];
  const label = image ? image[1] : attribute(videoTag[1], 'aria-label') ?? attribute(videoTag[1], 'title') ?? '';
  if (!target) return void warn('has a <video> without a src.');
  const resolved = ctx.resolve(target, label || target);
  if (!resolved.asset) return void (resolved.missing || warn(`points to ${target}, which is not a docs asset.`));
  const still = IMAGE_EXTENSIONS.test(resolved.asset) && !/\.svg$/iu.test(resolved.asset);
  if (!label.trim()) warn(`${resolved.asset} has no ${still ? 'alt text' : 'aria-label'}.`);
  if (still) {
    const size = imageSize(resolved.bytes);
    for (const issue of compareSizeIssues(size)) warn(`${resolved.asset} ${issue}.`);
    return size ? { kind: 'image', url: resolved.url, alt: label, size } : undefined;
  }
  if (!VIDEO_EXTENSIONS.test(resolved.asset)) return void warn(`points to ${resolved.asset}, which is neither a picture nor a clip.`);

  const stem = resolved.asset.replace(VIDEO_EXTENSIONS, '');
  const posterAttribute = videoTag ? attribute(videoTag[1], 'poster') : undefined;
  const sibling = (file) => (ctx.checkAsset(file, ctx.asset(file)), { asset: file, url: ctx.assetUrl(file), bytes: ctx.asset(file) });
  const poster = posterAttribute
    ? ctx.resolve(posterAttribute, posterAttribute)
    : ['webp', 'jpg', 'png'].map((ext) => `${stem}.${ext}`).filter((file) => ctx.asset(file)).map(sibling)[0];
  if (!poster?.asset) return void warn(`${resolved.asset} has no poster (${stem}.webp): the slider shows the poster's two halves until the loop plays.`);
  const posterSize = imageSize(poster.bytes);
  const clipSize = /\.mp4$/iu.test(resolved.asset) ? mp4Info(resolved.bytes) : undefined;
  for (const issue of compareSizeIssues(posterSize ?? clipSize)) warn(`${resolved.asset} ${issue}.`);
  if (posterSize && clipSize?.width && (posterSize.width !== clipSize.width || posterSize.height !== clipSize.height)) {
    warn(`${resolved.asset} is ${clipSize.width} × ${clipSize.height} px, its poster ${posterSize.width} × ${posterSize.height}: the halves would not line up.`);
  }
  if (!posterSize) return undefined;
  const files = ['webm', 'mp4'].map((ext) => `${stem}.${ext}`).filter((file) => ctx.asset(file));
  for (const file of files) if (file !== resolved.asset) ctx.checkAsset(file, ctx.asset(file));
  const track = ctx.asset(`${stem}.vtt`) ? `<track kind="captions" srclang="en" label="English" src="${ctx.assetUrl(`${stem}.vtt`)}">` : undefined;
  return { kind: 'video', label, track, poster: { url: poster.url, size: posterSize },
    sources: files.map((file) => ({ url: ctx.assetUrl(file), type: `video/${file.split('.').pop()}` })) };
}
