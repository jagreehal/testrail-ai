import { createStoryReporter } from 'executable-stories-vitest/reporter';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // Re-export barrels and entry points: the entry points are exercised by
      // spawning the built binary, which in-process coverage cannot see.
      exclude: ['src/**/*.test.ts', 'src/{index,stdio,http,smoke,smoke-write}.ts'],
      reporter: ['text-summary', 'html'],
      thresholds: { lines: 95, statements: 95, functions: 95, branches: 85 },
    },
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
        html: { title: 'testrail-ai-mcp' },
      }),
    ],
  },
});
