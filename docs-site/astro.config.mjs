// www.masterselects.com/docs — Astro Starlight site seeded from docs/Features.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://www.masterselects.com',
  base: '/docs',
  outDir: '../dist/docs',
  integrations: [
    starlight({
      title: 'MasterSelects Documentation',
      description:
        'Browser-based media editor and agent-friendly foundation for video, audio, motion, 3D, and creative tools.',
      logo: { src: './src/assets/ms-mark.png' },
      customCss: ['./src/styles/custom.css'],
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
