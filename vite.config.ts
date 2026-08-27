import { defineConfig } from 'vite';

// The app is deployed to https://<user>.github.io/ai-calorie-tracker/, so assets need the
// repository name as a base path in production. Locally the base stays '/'.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/ai-calorie-tracker/' : '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
    assetsInlineLimit: 0,
  },
}));
