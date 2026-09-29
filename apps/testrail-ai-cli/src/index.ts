#!/usr/bin/env node
import { Command, InvalidArgumentError } from 'commander';
import {
  formatCaseDetail,
  formatCoverage,
  formatFailures,
  formatRunReport,
  formatSearch,
  formatStability,
  getCaseDetail,
  getCoverage,
  getFailures,
  getRunReport,
  getStability,
  loadConfig,
  EntitySchema,
  search,
  TestRailClient,
  type Config,
  type Entity,
} from 'testrail-ai';

/**
 * The CLI: the same core, a different skin.
 *
 * Every command is the same shape as its MCP tool — validate, `get*`, `format*`
 * — because both call into `testrail-ai` rather than reimplementing anything.
 * The one thing the CLI adds is `--json`, which returns the `get*` result
 * untouched. That is what makes this usable from an agent skill or a CI job: the
 * markdown is for humans, the JSON is for pipes.
 */

const program = new Command();

program
  .name('testrail-ai')
  .description('TestRail for humans and agents — reports, triage, stability and coverage')
  .version('0.1.0')
  .option('--json', 'Emit the raw result as JSON instead of markdown')
  .option('--url <url>', 'TestRail URL (defaults to TESTRAIL_URL)')
  .option('--email <email>', 'TestRail email (defaults to TESTRAIL_EMAIL)')
  .option('--api-key <key>', 'TestRail API key (defaults to TESTRAIL_API_KEY)');

/** Positive integers, rejected loudly rather than silently becoming NaN. */
function intArg(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new InvalidArgumentError(`'${value}' is not a positive integer.`);
  }

  return parsed;
}

/** `--label 3,7` — a variadic option would collapse to the last id under `intArg`. */
function intListArg(value: string): number[] {
  return value.split(',').map((part) => intArg(part.trim()));
}

function nonNegativeIntArg(value: string): number {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new InvalidArgumentError(`'${value}' is not a non-negative integer.`);
  }

  return parsed;
}

function entityArg(value: string): Entity {
  const parsed = EntitySchema.safeParse(value);

  if (!parsed.success) {
    throw new InvalidArgumentError(`'${value}' is not a searchable entity.`);
  }

  return parsed.data;
}

/** What commander hands `search`'s action; it types every option `any` otherwise. */
type SearchOptions = {
  project?: number;
  run?: number;
  suite?: number;
  section?: number;
  sectionPath?: string;
  query?: string;
  priority?: number;
  type?: number;
  status?: number[];
  milestone?: number;
  completed?: boolean;
  open?: boolean;
  refs?: string;
  label?: number[];
  createdAfter?: string;
  updatedAfter?: string;
  limit: number;
};

type GlobalOptions = { json?: boolean; url?: string; email?: string; apiKey?: string };

/**
 * Flags beat environment, environment beats nothing. Resolved per command so a
 * one-off `--url` does not need an exported variable.
 */
function resolveConfig(): Config {
  const options = program.opts<GlobalOptions>();

  const base = loadConfig({
    ...process.env,
    ...(options.url && { TESTRAIL_URL: options.url }),
    ...(options.email && { TESTRAIL_EMAIL: options.email }),
    ...(options.apiKey && { TESTRAIL_API_KEY: options.apiKey }),
  });

  return base;
}

/**
 * One place where a command's two output modes are decided, so no command can
 * forget `--json`, and one place where errors become exit code 1 with a clean
 * message rather than a stack trace.
 */
async function run<T>(
  work: (context: { client: TestRailClient }) => Promise<T>,
  format: (result: T) => string,
): Promise<void> {
  try {
    const client = new TestRailClient(resolveConfig());
    const result = await work({ client });
    console.log(program.opts<GlobalOptions>().json ? JSON.stringify(result, null, 2) : format(result));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

program
  .command('search')
  .description('Find projects, suites, sections, cases, runs, plans, milestones or tests')
  .argument('<entity>', 'projects | suites | sections | cases | runs | plans | milestones | tests', entityArg)
  .option('-p, --project <id>', 'Project id', intArg)
  .option('-r, --run <id>', 'Run id (required for tests)', intArg)
  .option('-s, --suite <id>', 'Suite id', intArg)
  .option('--section <id>', 'Section id', intArg)
  .option('--section-path <path>', "Cases only: section by name, e.g. 'Checkout > Payments'")
  .option('-q, --query <text>', 'Substring match on title or name')
  .option('--priority <id>', 'Cases only: 1 Low … 4 Critical', intArg)
  .option('--type <id>', 'Cases only: case type id', intArg)
  .option('--status <ids>', 'Tests only: comma-separated status ids', intListArg)
  .option('--milestone <id>', 'Runs and plans only: milestone id', intArg)
  .option('--completed', 'Runs, plans and milestones: completed only')
  .option('--open', 'Runs, plans and milestones: open only')
  .option('--refs <ref>', "Cases only: the linked requirement, e.g. 'JIRA-1234'")
  .option('--label <ids>', 'Cases only: comma-separated label ids, matching any', intListArg)
  .option('--created-after <when>', "ISO date or relative offset ('7d', '24h', '2w')")
  .option('--updated-after <when>', 'Cases only. Same formats as --created-after')
  .option('-l, --limit <n>', 'Maximum rows', intArg, 50)
  .action(async (entity: Entity, options: SearchOptions) => {
    if (options.completed && options.open) {
      throw new InvalidArgumentError('--completed and --open are mutually exclusive.');
    }

    await run(
      async ({ client }) =>
        search(
          {
            entity,
            project_id: options.project ?? client.defaultProjectId,
            run_id: options.run,
            suite_id: options.suite,
            section_id: options.section,
            section_path: options.sectionPath,
            query: options.query,
            priority_id: options.priority,
            type_id: options.type,
            status_id: options.status,
            milestone_id: options.milestone,
            is_completed: options.completed ? true : options.open ? false : undefined,
            refs: options.refs,
            label_id: options.label,
            created_after: options.createdAfter,
            updated_after: options.updatedAfter,
            limit: options.limit,
          },
          { client },
        ),
      formatSearch,
    );
  });

program
  .command('report')
  .description('Full report on one run: totals, pass rate, failures clustered by cause')
  .argument('[run]', 'Run id. Omit to take the latest run in --project or the default project.', intArg)
  .option('-p, --project <id>', 'Take the latest run in this project', intArg)
  .option('--include-passed', 'List passing tests too', false)
  .action(async (runId: number | undefined, options: { project?: number; includePassed: boolean }) => {
    await run(
      async ({ client }) =>
        getRunReport(
          {
            run_id: runId,
            project_id: runId === undefined ? client.requireProject(options.project) : options.project,
            include_passed: options.includePassed,
          },
          { client },
        ),
      formatRunReport,
    );
  });

program
  .command('failures')
  .description('Non-passing tests in a run, with comments, per-step results and defects')
  .argument('<run>', 'Run id', intArg)
  .option('--last-good', 'Find the most recent earlier run where each case passed', false)
  .option('--lookback <n>', 'How many earlier runs to search', intArg, 10)
  .option('-l, --limit <n>', 'Maximum failures', intArg, 50)
  .action(async (runId: number, options: { lastGood: boolean; lookback: number; limit: number }) => {
    await run(
      async ({ client }) =>
        getFailures(
          {
            run_id: runId,
            include_last_good: options.lastGood,
            lookback_runs: options.lookback,
            limit: options.limit,
          },
          { client },
        ),
      formatFailures,
    );
  });

program
  .command('stability')
  .alias('flaky')
  .description('Flaky vs regressed vs recovered across recent runs')
  .argument('[project]', 'Project id. Defaults to TESTRAIL_PROJECT_ID.', intArg)
  .option('-s, --suite <id>', 'Restrict to one suite', intArg)
  .option('-r, --runs <n>', 'How many recent runs to compare', intArg, 10)
  .option('--min-flips <n>', 'Minimum pass/fail transitions to count as flaky (min 2)', intArg, 2)
  .action(
    async (projectId: number | undefined, options: { suite?: number; runs: number; minFlips: number }) => {
      await run(
        async ({ client }) =>
          getStability(
            {
              project_id: client.requireProject(projectId),
              suite_id: options.suite,
              runs: options.runs,
              min_flips: options.minFlips,
            },
            { client },
          ),
        formatStability,
      );
    },
  );

program
  .command('coverage')
  .description('What the suite is not testing')
  .argument('[project]', 'Project id. Defaults to TESTRAIL_PROJECT_ID.', intArg)
  .option('-s, --suite <id>', 'Restrict to one suite', intArg)
  .option('-r, --run <id>', 'Also report which cases this run skipped', intArg)
  .option('--recent-runs <n>', 'How many runs count as "recently executed"', nonNegativeIntArg, 5)
  .option('--refs <keys>', 'Comma-separated requirement keys to check for coverage')
  .option('-l, --limit <n>', 'Maximum cases to read', intArg, 500)
  .action(
    async (
      projectId: number | undefined,
      options: { suite?: number; run?: number; recentRuns: number; refs?: string; limit: number },
    ) => {
      await run(
        async ({ client }) =>
          getCoverage(
            {
              project_id: client.requireProject(projectId),
              suite_id: options.suite,
              run_id: options.run,
              recent_runs: options.recentRuns,
              refs: options.refs
                ?.split(',')
                .map((ref) => ref.trim())
                .filter(Boolean),
              limit: options.limit,
            },
            { client },
          ),
        formatCoverage,
      );
    },
  );

program
  .command('case')
  .description('Full detail on one test case')
  .argument('<case>', 'Case id', intArg)
  .option('--no-history', 'Skip recent execution history (faster)')
  .action(async (caseId: number, options: { history: boolean }) => {
    await run(
      async ({ client }) => getCaseDetail({ case_id: caseId, include_history: options.history }, { client }),
      formatCaseDetail,
    );
  });

program
  .command('projects')
  .description('List every project — the usual starting point')
  .action(async () => {
    await run(async ({ client }) => search({ entity: 'projects', limit: 250 }, { client }), formatSearch);
  });

program.parseAsync().catch((cause: unknown) => {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exitCode = 1;
});
