// docs.masterselects.com — Astro Starlight site seeded from docs/Features.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.masterselects.com',
  integrations: [
    starlight({
      title: 'MasterSelects Documentation',
      description:
        'Browser-based WebGPU video editor: timeline editing, motion design, replicators, audio workstation, and AI-assisted workflows.',
      logo: { src: './src/assets/ms-mark.png' },
      customCss: ['./src/styles/custom.css'],
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/Sportinger/MasterSelects',
        },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Welcome', slug: 'getting-started/welcome' },
            { label: 'Overview', slug: 'getting-started/overview' },
          ],
        },
        {
          label: 'Features',
          autogenerate: { directory: 'features' },
        },
      ],
    }),
  ],
});
