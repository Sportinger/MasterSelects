// www.masterselects.com/docs — Astro Starlight site seeded from docs/Features.
import fs from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// scripts/sync-features.mjs generates the sidebar (from the "## Documentation Index" of
// docs/Features/README.md) and the redirects (from docs/Features/redirects.json). Both files
// are untracked: `npm run dev` and `npm run build` run the sync first.
const sidebarFile = new URL('./src/generated/sidebar.json', import.meta.url);
const redirectsFile = new URL('./src/generated/redirects.json', import.meta.url);
const docsClipsScript = new URL('./src/scripts/docsClips.js', import.meta.url);
function readGenerated(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    console.warn(`${file.pathname} is missing: run "npm run sync" in docs-site first.`);
    return fallback;
  }
}
const featureGroups = readGenerated(sidebarFile, []);
const redirects = readGenerated(redirectsFile, {});

// The site's own start pages lead the sidebar when the index does not list them.
const listsWelcome = JSON.stringify(featureGroups).includes('"getting-started/welcome"');
const sidebar = listsWelcome
  ? featureGroups
  : [{ label: 'Getting Started', items: [{ label: 'Welcome', slug: 'getting-started/welcome' }, { label: 'Overview', slug: 'getting-started/overview' }] }, ...featureGroups];

export default defineConfig({
  site: 'https://www.masterselects.com',
  base: '/docs',
  outDir: '../dist/docs',
  // Old paths relative to the /docs base; targets are full /docs/… URLs.
  redirects,
  integrations: [
    starlight({
      title: 'MasterSelects Documentation',
      description:
        'Browser-based media editor and agent-friendly foundation for video, audio, motion, 3D, and creative tools.',
      logo: { src: './src/assets/ms-mark.png' },
      customCss: ['./src/styles/custom.css'],
      // Docs clips start when scrolled into view and respect reduced motion (inline: a few lines).
      head: [{ tag: 'script', attrs: { type: 'module' }, content: fs.readFileSync(docsClipsScript, 'utf8') }],
      sidebar,
    }),
    // A running `astro dev` restarts when a sync changes the generated sidebar or redirects,
    // or when the clip script changes.
    {
      name: 'masterselects-feature-sidebar',
      hooks: {
        'astro:config:setup': ({ addWatchFile }) => {
          addWatchFile(sidebarFile);
          addWatchFile(redirectsFile);
          addWatchFile(docsClipsScript);
        },
      },
    },
  ],
});
