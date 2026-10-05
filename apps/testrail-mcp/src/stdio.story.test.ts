import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';

/**
 * The stdio binary's `--env-file`, run as a user would start it. The server
 * logs its target on stderr before serving, which is all these need.
 */

const ENTRY = fileURLToPath(new URL('../dist/stdio.js', import.meta.url));

async function run(args: string[], env: Record<string, string> = {}, cwd?: string) {
  const proc = spawn(process.execPath, [ENTRY, ...args], {
    cwd,
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  let output = '';
  proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(proc, 'exit');
  // Wait for the startup line or an exit, then close stdin so a serving process ends.
  await Promise.race([
    new Promise<void>((resolve) => proc.stderr.on('data', () => output.includes('→') && resolve())),
    exited,
  ]);
  proc.kill();
  await exited;

  return output;
}

function envFile(contents: string) {
  const dir = mkdtempSync(join(tmpdir(), 'testrail-env-'));
  const path = join(dir, 'testrail.env');
  writeFileSync(path, contents);

  return { dir, path };
}

const FILE = 'TESTRAIL_URL=https://file.testrail.io\nTESTRAIL_EMAIL=qa@example.com\nTESTRAIL_API_KEY=key\n';

describe('stdio --env-file', () => {
  it('loads the named file', async ({ task }) => {
    story.init(task, { tags: ['stdio', 'config'], covers: ['src/stdio.ts'] });

    story.given('an env file and no TESTRAIL_* variables');
    const { path } = envFile(FILE);

    story.then('the server starts against the URL in the file');
    expect(await run(['--env-file', path])).toContain('testrail-ai-mcp → https://file.testrail.io');
  });

  it('lets the environment win over the file', async ({ task }) => {
    story.init(task, { tags: ['stdio', 'config'], covers: ['src/stdio.ts'] });

    story.given('TESTRAIL_URL set in the environment and in the file');
    const { path } = envFile(FILE);

    story.then('the environment value is used');
    expect(await run(['--env-file', path], { TESTRAIL_URL: 'https://env.testrail.io' })).toContain(
      'testrail-ai-mcp → https://env.testrail.io',
    );
  });

  it('refuses a relative path', async ({ task }) => {
    story.init(task, { tags: ['stdio', 'config'], covers: ['src/stdio.ts'] });

    story.given('--env-file testrail.env, relative to the working directory');
    const { dir } = envFile(FILE);

    story.then('it exits without reading it');
    expect(await run(['--env-file', 'testrail.env'], {}, dir)).toContain(
      '--env-file needs an absolute path.',
    );
  });

  it('never reads ./.env on its own', async ({ task }) => {
    story.init(task, { tags: ['stdio', 'config'], covers: ['src/stdio.ts'] });

    story.given('a .env in the working directory and no flag');
    const { dir } = envFile(FILE);
    writeFileSync(join(dir, '.env'), FILE);

    story.then('it is ignored and the server says it is not configured');
    expect(await run([], {}, dir)).toContain('TestRail MCP is not configured.');
  });
});
