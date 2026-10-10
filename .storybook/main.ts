import { defineMain } from '@storybook/react-vite/node';

export default defineMain({
  stories: ['../src/stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-docs', 'storybook-addon-externalsss'],
  framework: '@storybook/react-vite',
});
