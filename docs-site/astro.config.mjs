// www.masterselects.com/docs — Astro Starlight site seeded from docs/Features.
import fs from 'node:fs';
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// scripts/sync-features.mjs generates the sidebar (from the "## Documentation Index" of
// docs/Features/README.md) and the redirects (from docs/Features/redirects.json). Both files
// are untracked: `npm run dev` and `npm run build` run the sync first.
const sidebarFile = new URL('./src/generated/sidebar.json', import.meta.url);
const redirectsFile = new URL('./src/generated/redirects.json', import.meta.url);
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

// Docs clips (<video data-docs-autoplay>) loop while visible; with reduced motion they keep
// their poster and controls and never start by themselves.
const clipScript = `(() => {
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const start = () => {
    const clips = document.querySelectorAll('video[data-docs-autoplay]');
    if (!clips.length) return;
    const watch = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
      for (const { target, isIntersecting } of entries) {
        if (motion.matches || !isIntersecting) target.pause();
        else target.play().catch(() => { target.controls = true; });
      }
    }, { threshold: 0.25 }) : undefined;
    const apply = () => {
      for (const clip of clips) {
        clip.controls = motion.matches;
        if (motion.matches) clip.pause();
        else if (!watch) clip.play().catch(() => { clip.controls = true; });
      }
    };
    apply();
    for (const clip of clips) watch?.observe(clip);
    motion.addEventListener('change', apply);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();`;

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
      head: [{ tag: 'script', content: clipScript }],
      sidebar,
    }),
    // A running `astro dev` restarts when a sync changes the generated sidebar or redirects.
    {
      name: 'masterselects-feature-sidebar',
      hooks: {
        'astro:config:setup': ({ addWatchFile }) => {
          addWatchFile(sidebarFile);
          addWatchFile(redirectsFile);
        },
      },
    },
  ],
});
