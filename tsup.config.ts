import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/manager.tsx', 'src/preview.ts'],
  outDir: 'dist',
  clean: false,
  format: ['esm'],
  platform: 'browser',
  target: 'esnext',
  dts: true,
  splitting: false,
  external: ['react', 'react-dom', 'react/jsx-runtime', 'storybook/manager-api', 'storybook/preview-api', 'storybook/theming', 'storybook/internal/components', 'storybook/internal/core-events'],
});
