import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

/**
 * The runtime exports of every entry point, as a consumer sees them. Adding or
 * removing one changes this snapshot, so the change is visible in review and
 * the changeset can say so.
 */
describe('Public API', () => {
  it.each(['testrail-ai', 'testrail-ai/advanced', 'testrail-ai/testing', 'testrail-ai-mcp'])(
    '%s exports',
    async (entry) => {
      const module: object = await import(entry);

      expect(Object.keys(module).toSorted()).toMatchSnapshot();
    },
  );

  it('offers the same core exports to CommonJS', async () => {
    const esm: object = await import('testrail-ai');
    const cjs: object = require('testrail-ai');

    expect(Object.keys(cjs).toSorted()).toEqual(Object.keys(esm).toSorted());
  });
});
