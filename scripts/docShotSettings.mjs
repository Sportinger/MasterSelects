// What every docs picture and clip is made from, in one place: the footage, the test images, the
// editor theme and the frame of the effect clips. The docs tools (effect-lab.mjs, doc-clip.mjs,
// effect-graph-shot.mjs, effect-editor-shot.mjs and the runner docs-media.mjs) read it, so new
// footage or another theme is one change here. For one run, an environment variable overrides it:
// DOCS_FOOTAGE_DIR (or the older DOC_CLIP_MEDIA, or --media), DOCS_THEME.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DOC_SHOT_DEFAULTS = Object.freeze({
  /** Moving footage of the docs clips (dancer_stage_motion.mp4, 1080p, see its README). */
  footageDir: 'tests/browser/effect-lab/footage',
  /** Stills of the Effect Lab and the editor shots (dancer_stage, harbor_town, neon_rain_street, greenscreen_dancer). */
  imageDir: 'tests/browser/effect-lab/images',
  /** Editor theme of the editor excerpts and operation clips (ThemeMode in src/stores/settings/settingsOptions.ts). */
  theme: 'dark',
  /** The frame an effect clip is rendered and exported in, whatever the footage size: clip crops are in its pixels. */
  frame: Object.freeze({ width: 1920, height: 1080 }),
});

/** The settings of this run: the defaults above with the environment's overrides. */
export function docShotSettings(env = process.env) {
  return {
    ...DOC_SHOT_DEFAULTS,
    footageDir: env.DOCS_FOOTAGE_DIR || DOC_SHOT_DEFAULTS.footageDir,
    theme: env.DOCS_THEME || DOC_SHOT_DEFAULTS.theme,
  };
}

/**
 * The folders a recipe's media name ("dancer_stage_motion.mp4") is looked up in, in order: --media,
 * DOC_CLIP_MEDIA, the footage setting, the test images.
 */
export function mediaDirs({ media, env = process.env } = {}) {
  const settings = docShotSettings(env);
  return [media, env.DOC_CLIP_MEDIA, settings.footageDir, settings.imageDir].filter(Boolean)
    .map((dir) => path.resolve(REPO_ROOT, dir));
}

/** The absolute file of a recipe's media name (or path), or undefined when no folder has it. */
export function findMedia(name, options = {}) {
  if (!name) return undefined;
  const candidates = [path.resolve(REPO_ROOT, name), ...mediaDirs(options).map((dir) => path.join(dir, name))];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
}

/**
 * Where a file of the repository is written: the file itself, or the same path under
 * DOCS_MEDIA_OUT_ROOT, so a run of the runner into a scratch folder never touches the committed assets.
 */
export function docOutput(file, env = process.env) {
  const absolute = path.resolve(REPO_ROOT, file);
  const outRoot = env.DOCS_MEDIA_OUT_ROOT;
  const relative = path.relative(REPO_ROOT, absolute);
  if (!outRoot || relative.startsWith('..') || path.isAbsolute(relative)) return absolute;
  return path.join(path.resolve(outRoot), relative);
}

/** The repository path a written file stands for (undoes docOutput), for printed figures and the manifest. */
export function docLogicalPath(file, env = process.env) {
  const absolute = path.resolve(REPO_ROOT, file);
  const outRoot = env.DOCS_MEDIA_OUT_ROOT ? path.resolve(env.DOCS_MEDIA_OUT_ROOT) : undefined;
  const inside = outRoot ? path.relative(outRoot, absolute) : '..';
  return inside.startsWith('..') || path.isAbsolute(inside) ? absolute : path.join(REPO_ROOT, inside);
}

/** Whether this run writes into a scratch folder instead of the repository. */
export const scratchRun = (env = process.env) => Boolean(env.DOCS_MEDIA_OUT_ROOT);

/**
 * The URL the running editor loaded one of its modules from. Once a file was edited, Vite serves the
 * changed module's importers with `?t=<time>` imports, and `import('/src/x.ts')` from a script would load
 * a second copy whose stores the editor never reads. `importer` is a module that imports it.
 */
export async function appModuleUrl(page, modulePath, importer) {
  return page.evaluate(async ({ modulePath, importer }) => {
    const source = await (await fetch(importer)).text();
    const escaped = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return source.match(new RegExp(`["'](${escaped}(?:\\?[^"']*)?)["']`))?.[1] ?? modulePath;
  }, { modulePath, importer });
}

/** Switches the open editor to the theme of the settings (the editor starts dark) and checks that it shows it. */
export async function applyEditorTheme(page, theme = docShotSettings().theme) {
  const url = await appModuleUrl(page, '/src/stores/settingsStore.ts', '/src/hooks/useTheme.ts');
  const shown = await page.evaluate(async ({ url, value }) => {
    const { useSettingsStore } = await import(url);
    useSettingsStore.getState().setTheme(value);
    const wanted = value === 'system' ? ['dark', 'light'] : [value];
    for (let frame = 0; frame < 60 && !wanted.includes(document.documentElement.dataset.theme); frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
    return document.documentElement.dataset.theme;
  }, { url, value: theme });
  if (shown !== theme && !(theme === 'system' && (shown === 'dark' || shown === 'light'))) {
    throw new Error(`Editor theme "${theme}" did not reach the editor (it shows "${shown}").`);
  }
}
