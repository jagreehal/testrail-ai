import { accessSync, constants } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');

const require = createRequire(import.meta.url);

function exists(relativePath, mode = constants.F_OK) {
  accessSync(resolve(root, relativePath), mode);
}

function run(relativePath, args, expectedStatus, expectedText) {
  const result = spawnSync(process.execPath, [resolve(root, relativePath), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 10_000,
  });

  if (result.status !== expectedStatus) {
    throw new Error(`${relativePath} exited ${String(result.status)}; stderr: ${result.stderr}`);
  }

  if (!`${result.stdout}${result.stderr}`.includes(expectedText)) {
    throw new Error(`${relativePath} did not emit ${JSON.stringify(expectedText)}.`);
  }
}

function evaluate(relativeDirectory, args) {
  const result = spawnSync(process.execPath, args, {
    cwd: resolve(root, relativeDirectory),
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
    timeout: 10_000,
  });

  if (result.status !== 0) {
    throw new Error(`Package export check failed in ${relativeDirectory}: ${result.stderr}`);
  }
}

for (const target of [
  'packages/testrail-ai/dist/index.js',
  'packages/testrail-ai/dist/index.cjs',
  'packages/testrail-ai/dist/testing.js',
  'packages/testrail-ai/dist/testing.cjs',
  'packages/testrail-ai/dist/advanced.js',
  'packages/testrail-ai/dist/advanced.cjs',
  'apps/testrail-ai-cli/dist/index.js',
  'apps/testrail-mcp/dist/stdio.js',
]) {
  exists(target);
}

await Promise.all([
  import(pathToFileURL(resolve(root, 'packages/testrail-ai/dist/index.js')).href),
  import(pathToFileURL(resolve(root, 'packages/testrail-ai/dist/testing.js')).href),
  import(pathToFileURL(resolve(root, 'packages/testrail-ai/dist/advanced.js')).href),
]);

require(resolve(root, 'packages/testrail-ai/dist/index.cjs'));

require(resolve(root, 'packages/testrail-ai/dist/testing.cjs'));

require(resolve(root, 'packages/testrail-ai/dist/advanced.cjs'));

evaluate('packages/testrail-ai', [
  '--input-type=module',
  '--eval',
  "await Promise.all([import('testrail-ai'), import('testrail-ai/testing'), import('testrail-ai/advanced')]);",
]);

evaluate('packages/testrail-ai', [
  '--eval',
  "require('testrail-ai'); require('testrail-ai/testing'); require('testrail-ai/advanced');",
]);

evaluate('apps/testrail-mcp', ['--input-type=module', '--eval', "await import('testrail-ai-mcp');"]);

run('apps/testrail-ai-cli/dist/index.js', ['--help'], 0, 'testrail-ai');

run('apps/testrail-mcp/dist/stdio.js', [], 1, 'TESTRAIL_URL');

console.log('Built package imports and executable targets are valid.');
