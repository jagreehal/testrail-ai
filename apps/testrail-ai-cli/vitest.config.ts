import { createStoryReporter } from 'executable-stories-vitest/reporter';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    reporters: [
      'default',
      createStoryReporter({
        formats: ['markdown'],
        outputDir: 'docs',
        outputName: 'stories',
        output: { mode: 'aggregated' },
        markdown: {
          includeMetadata: false,
          includeStatusIcons: true,
          stepStyle: 'bullets',
          sortScenarios: 'source',
        },
      }),
      // reports/test-results.{html,md}: what the executable-stories action posts on a PR.
      createStoryReporter({
        formats: ['html', 'markdown'],
        outputDir: 'reports',
        outputName: 'test-results',
        html: { title: 'testrail-ai-cli' },
      }),
    ],
  },
});
