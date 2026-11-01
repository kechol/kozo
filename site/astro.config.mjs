// @ts-check
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

// GitHub Pages serves the site under the repository's name, so every link carries the base.
export default defineConfig({
  site: 'https://kechol.github.io',
  base: '/kozo',
  integrations: [
    starlight({
      title: 'kozo',
      description:
        'A personal software factory that turns requests into small, verified diffs on your own machine.',
      defaultLocale: 'root',
      locales: {
        root: { label: 'English', lang: 'en' },
        ja: { label: '日本語', lang: 'ja' },
      },
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/kechol/kozo' }],
      editLink: { baseUrl: 'https://github.com/kechol/kozo/edit/main/site/' },
      expressiveCode: { defaultProps: { frame: 'code' } },
      sidebar: [
        {
          label: 'Start Here',
          translations: { ja: 'はじめに' },
          items: [
            { label: 'Quick Start', translations: { ja: 'クイックスタート' }, slug: 'quick-start' },
            { label: 'Concept', translations: { ja: 'コンセプト' }, slug: 'concept' },
            { label: 'Installation', translations: { ja: 'インストール' }, slug: 'installation' },
          ],
        },
        {
          label: 'Guides',
          translations: { ja: 'ガイド' },
          items: [
            { label: 'GitHub mode', translations: { ja: 'GitHub モード' }, slug: 'github-mode' },
            { label: 'Dashboard', translations: { ja: 'ダッシュボード' }, slug: 'dashboard' },
          ],
        },
      ],
    }),
  ],
});
