import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { story } from 'executable-stories-vitest';
import type { Json } from 'testrail-ai';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

const ExecFailureSchema = z.looseObject({
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  // A number for a non-zero exit; a string such as ENOENT when the process never started.
  code: z.number().optional().catch(undefined),
});

/**
 * The CLI, exercised as a user runs it: a real process, real argv, real exit
 * codes. Importing the module instead would skip commander's parsing, which is
 * the only part of this app that is actually its own.
 *
 * A tiny stub server stands in for TestRail so these tests need no network and
 * no credentials.
 */

const run = promisify(execFile);

// The built binary, not the source: this is the artifact users install, and
// running it through `node` keeps the test free of a transpiler in the loop.
const ENTRY = fileURLToPath(new URL('../dist/index.js', import.meta.url));

type CliResult = { stdout: string; stderr: string; code: number };

async function cli(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  try {
    const { stdout, stderr } = await run(process.execPath, [ENTRY, ...args], {
      env: { ...process.env, ...env },
      timeout: 60_000,
    });

    return { stdout, stderr, code: 0 };
  } catch (error) {
    // execFile rejects with the process output attached.
    const failure = ExecFailureSchema.parse(error);

    return { stdout: failure.stdout ?? '', stderr: failure.stderr ?? '', code: failure.code ?? 1 };
  }
}

/** A stub TestRail on loopback, so the CLI's own HTTP path is exercised. */
async function stubTestRail(routes: Record<string, Json>) {
  const { createServer } = await import('node:http');

  const server = createServer((request, response) => {
    const endpoint = decodeURIComponent((request.url ?? '').split('/api/v2/')[1] ?? '');

    const match = Object.entries(routes)
      .filter(([prefix]) => endpoint.startsWith(prefix))
      .toSorted(([a], [b]) => b.length - a.length)[0];

    response.writeHead(match ? 200 : 404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(match ? match[1] : { error: `no route: ${endpoint}` }));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = z.object({ port: z.number() }).parse(server.address());

  return {
    env: {
      TESTRAIL_URL: `http://127.0.0.1:${port}`,
      TESTRAIL_EMAIL: 'qa@example.com',
      TESTRAIL_API_KEY: 'key',
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const REFERENCE_DATA = {
  get_statuses: [
    { id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false },
    { id: 3, name: 'untested', label: 'Untested', is_final: false, is_untested: true },
    { id: 5, name: 'failed', label: 'Failed', is_final: true, is_untested: false },
  ],
  get_priorities: [{ id: 2, name: 'Medium', short_name: 'Medium' }],
  get_case_types: [{ id: 7, name: 'Other' }],
  get_users: { users: [] },
};

describe('Running the CLI', () => {
  it('lists its commands so an agent skill can discover them', async ({ task }) => {
    story.init(task, { tags: ['cli'], covers: ['src/index.ts'] });

    story.given('the CLI with no arguments beyond --help');
    story.when('help is printed');
    const result = await cli(['--help']);
    story.code({ label: 'Output', content: result.stdout });

    story.then('every workflow command is listed');

    for (const command of ['search', 'report', 'failures', 'stability', 'coverage', 'case', 'projects']) {
      expect(result.stdout, command).toContain(command);
    }

    story.and('--json is advertised, because that is what makes it scriptable');
    expect(result.stdout).toContain('--json');
  });

  it('refuses to start without credentials, naming what is missing', async ({ task }) => {
    story.init(task, { tags: ['cli', 'config'], covers: ['src/index.ts'] });

    story.given('an environment with no TestRail configuration');
    story.when('a command is run');

    const result = await cli(['projects'], {
      TESTRAIL_URL: '',
      TESTRAIL_EMAIL: '',
      TESTRAIL_API_KEY: '',
      TESTRAIL_USERNAME: '',
    });

    story.code({ label: 'stderr', content: result.stderr });

    story.then('it exits non-zero rather than half-working');
    expect(result.code).not.toBe(0);

    story.and('each missing variable is named');
    expect(result.stderr).toContain('TESTRAIL_URL');
    expect(result.stderr).toContain('TESTRAIL_API_KEY');
  });

  it('rejects a non-numeric id instead of querying for NaN', async ({ task }) => {
    story.init(task, { tags: ['cli', 'validation'] });

    story.given('a run id that is not a number');
    story.when('the report command is run');
    const result = await cli(['report', 'not-a-number']);

    story.then('it is rejected before any request is made');
    story.note('Without this the CLI would ask TestRail for run NaN and get a confusing 400 back.');
    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toMatch(/not a positive integer/);
  });

  it('rejects an unknown search entity during argument parsing', async ({ task }) => {
    story.init(task, { tags: ['cli', 'validation', 'regression'] });

    const result = await cli(['search', 'unknown'], {
      TESTRAIL_URL: '',
      TESTRAIL_EMAIL: '',
      TESTRAIL_API_KEY: '',
    });

    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain('not a searchable entity');
    expect(`${result.stderr}${result.stdout}`).not.toContain('TESTRAIL_URL');
  });

  it('rejects contradictory completion filters', async ({ task }) => {
    story.init(task, { tags: ['cli', 'validation'] });

    const result = await cli(['search', 'runs', '--completed', '--open']);

    expect(result.code).not.toBe(0);
    expect(`${result.stderr}${result.stdout}`).toContain('mutually exclusive');
  });
});

describe('Talking to TestRail from the CLI', () => {
  it('accepts zero recent runs to skip execution-history coverage', async ({ task }) => {
    story.init(task, { tags: ['cli', 'coverage', 'validation', 'regression'] });

    const stub = await stubTestRail({
      ...REFERENCE_DATA,
      get_cases: {
        cases: [{ id: 1, title: 'Login', priority_id: 2, type_id: 7, refs: null, updated_on: 1 }],
      },
    });

    try {
      const result = await cli(['--json', 'coverage', '5', '--recent-runs', '0'], stub.env);
      const report = z.object({ neverExecuted: z.null() }).parse(JSON.parse(result.stdout));
      expect(result.code).toBe(0);
      expect(report.neverExecuted).toBeNull();
    } finally {
      await stub.close();
    }
  });
  it('uses the default project when the project argument is left out', async ({ task }) => {
    story.init(task, { tags: ['cli', 'configuration'], covers: ['src/index.ts'] });

    const stub = await stubTestRail({
      ...REFERENCE_DATA,
      get_cases: {
        cases: [{ id: 1, title: 'Login', priority_id: 2, type_id: 7, refs: null, updated_on: 1 }],
      },
    });

    try {
      story.when('`coverage` is run with TESTRAIL_PROJECT_ID=5 and no project');

      const result = await cli(['--json', 'coverage', '--recent-runs', '0'], {
        ...stub.env,
        TESTRAIL_PROJECT_ID: '5',
      });

      expect(result.code).toBe(0);
      expect(z.object({ projectId: z.number() }).parse(JSON.parse(result.stdout)).projectId).toBe(5);

      story.and('without a default it asks for one');
      const missing = await cli(['coverage', '--recent-runs', '0'], stub.env);
      expect(missing.code).not.toBe(0);
      expect(`${missing.stderr}${missing.stdout}`).toContain('no default project is set');
    } finally {
      await stub.close();
    }
  });

  it('prints a readable table by default', async ({ task }) => {
    story.init(task, { tags: ['cli'], covers: ['src/index.ts'] });

    story.given('a TestRail with two projects');

    const stub = await stubTestRail({
      ...REFERENCE_DATA,
      get_projects: {
        projects: [
          { id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false },
          { id: 6, name: 'Curve Pay', suite_mode: 1, is_completed: false },
        ],
      },
    });

    try {
      story.when('`projects` is run');
      const result = await cli(['projects'], stub.env);
      story.code({ label: 'Output', content: result.stdout, lang: 'markdown' });

      story.then('a markdown table comes back on stdout');
      expect(result.code).toBe(0);
      expect(result.stdout).toContain('| id | name | suite mode | completed |');
      expect(result.stdout).toContain('Curve Core');
    } finally {
      await stub.close();
    }
  });

  it('emits the underlying data with --json, for pipes and skills', async ({ task }) => {
    story.init(task, { tags: ['cli', 'json'], covers: ['src/index.ts'] });

    story.given('the same TestRail');

    const stub = await stubTestRail({
      ...REFERENCE_DATA,
      get_projects: { projects: [{ id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false }] },
    });

    try {
      story.when('`projects --json` is run');
      const result = await cli(['--json', 'projects'], stub.env);
      story.code({ label: 'Output', content: result.stdout, lang: 'json' });

      story.then('stdout is valid JSON, not markdown');
      story.note('This is what lets an agent skill shell out and parse the result.');

      const parsed = z
        .object({ entity: z.string(), raw: z.array(z.json()) })
        .parse(JSON.parse(result.stdout));

      expect(parsed.entity).toBe('projects');

      story.and('the raw TestRail entities are included, not just the rendered table');
      expect(parsed.raw).toHaveLength(1);
    } finally {
      await stub.close();
    }
  });

  it('classifies stability the same way the MCP server does', async ({ task }) => {
    story.init(task, { tags: ['cli', 'stability'], covers: ['src/index.ts'] });

    story.given('a project where one case regressed and one is genuinely flaky');

    const stub = await stubTestRail({
      ...REFERENCE_DATA,
      'get_plans/5': { plans: [] },
      'get_runs/5': {
        runs: [
          { id: 3, created_on: 300 },
          { id: 2, created_on: 200 },
          { id: 1, created_on: 100 },
        ],
      },
      'get_tests/1': {
        tests: [
          { id: 1, case_id: 10, title: 'Login', status_id: 1 },
          { id: 2, case_id: 20, title: 'Checkout', status_id: 1 },
        ],
      },
      'get_tests/2': {
        tests: [
          { id: 3, case_id: 10, title: 'Login', status_id: 5 },
          { id: 4, case_id: 20, title: 'Checkout', status_id: 1 },
        ],
      },
      'get_tests/3': {
        tests: [
          { id: 5, case_id: 10, title: 'Login', status_id: 1 },
          { id: 6, case_id: 20, title: 'Checkout', status_id: 5 },
        ],
      },
    });

    try {
      story.when('`stability 5 --json` is run');
      const result = await cli(['--json', 'stability', '5', '--runs', '3'], stub.env);

      const output = z.json().parse(JSON.parse(result.stdout));
      const Verdicts = z.array(z.object({ caseId: z.number() }));
      const report = z.object({ flaky: Verdicts, regressed: Verdicts }).parse(output);

      story.json({ label: 'Verdicts', value: output });

      story.then('only the alternating case is flaky');
      expect(report.flaky.map((row) => row.caseId)).toEqual([10]);

      story.and('the one that broke and stayed broken is regressed');
      story.note('Same core function as the MCP tool — the two frontends cannot disagree.');
      expect(report.regressed.map((row) => row.caseId)).toEqual([20]);
    } finally {
      await stub.close();
    }
  });

  it("passes TestRail's own error through with a non-zero exit", async ({ task }) => {
    story.init(task, { tags: ['cli', 'errors'] });

    story.given('a TestRail that knows nothing about the requested run');
    const stub = await stubTestRail(REFERENCE_DATA);

    try {
      story.when('a report is requested for it');
      const result = await cli(['report', '999'], stub.env);
      story.code({ label: 'stderr', content: result.stderr });

      story.then('the exit code marks the failure, so CI notices');
      expect(result.code).not.toBe(0);

      story.and('the message goes to stderr, leaving stdout clean for pipes');
      expect(result.stderr).toContain('404');
      expect(result.stdout).toBe('');
    } finally {
      await stub.close();
    }
  });
});
