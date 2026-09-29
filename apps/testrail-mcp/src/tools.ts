import type { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  CaseDetailInputSchema,
  CaseWriteFieldsSchema,
  CoverageInputSchema,
  FailuresInputSchema,
  RawInputSchema,
  ReportResultsInputSchema,
  RunReportInputSchema,
  RunWriteFieldsSchema,
  SearchInputSchema,
  StabilityInputSchema,
  closeRun,
  createCase,
  createRun,
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
  reportResults,
  search,
  updateCase,
  updateRun,
  type TestRailClient,
} from 'testrail-ai';
import { isWriteEndpoint, table, truncate } from 'testrail-ai/advanced';

/**
 * The MCP surface, and almost nothing else.
 *
 * Every tool here is the same three lines: validate (the schema comes from the
 * core package), call a `get*`, hand the result to a `format*`. There is no
 * TestRail logic in this file, which is what keeps the CLI and the MCP server
 * from drifting — they are two thin skins over one implementation.
 */

/**
 * A tool-level failure is a RESULT with `isError`, not a thrown protocol error:
 * the model sees it and can recover, where a protocol error never reaches the
 * conversation at all.
 */
function ok(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

function fail(cause: unknown) {
  const message = cause instanceof Error ? cause.message : String(cause);

  return { isError: true as const, content: [{ type: 'text' as const, text: message }] };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: true } as const;

export function registerTools(server: McpServer, client: TestRailClient): void {
  const writeNote = client.allowWrites
    ? ' Writes are enabled on this server.'
    : ' Writes are DISABLED on this server; this tool will refuse until TESTRAIL_ALLOW_WRITES=true.';

  // With TESTRAIL_PROJECT_ID set, every project_id may be left out; the schema
  // says which project that means, so the model is never guessing.
  const defaultProject = client.defaultProjectId;

  const projectField = (purpose: string) =>
    z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        defaultProject === undefined
          ? `${purpose}. No default project is set.`
          : `${purpose}. Defaults to project ${defaultProject}.`,
      );

  server.registerTool(
    'testrail_search',
    {
      title: 'Search TestRail',
      description:
        'Find projects, suites, sections, cases, runs, plans, milestones or tests. ' +
        'Start here when you do not already know the id you need. ' +
        'Returns a compact table; use testrail_case or testrail_run_report for full detail on one row.',
      inputSchema: SearchInputSchema.extend({
        project_id: projectField('Required for everything except projects and tests'),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        return ok(
          formatSearch(
            await search({ ...input, project_id: input.project_id ?? defaultProject }, { client }),
          ),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_run_report',
    {
      title: 'Run report',
      description:
        'Everything about one test run in a single call: totals, pass rate, every non-passing test, ' +
        'and failures grouped into clusters by root cause. ' +
        'This is the tool for "how did run X go?" or "summarise last night\'s regression".',
      inputSchema: RunReportInputSchema.extend({
        project_id: projectField('Used with no run_id to pick the latest run'),
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const project_id =
          input.run_id === undefined ? (input.project_id ?? defaultProject) : input.project_id;

        return ok(formatRunReport(await getRunReport({ ...input, project_id }, { client })));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_failures',
    {
      title: 'Failures with context',
      description:
        'The failing, blocked and retest tests in a run, each with its latest result comment, ' +
        'per-step outcomes, linked defects and elapsed time. Optionally finds the most recent earlier ' +
        'run where each case last passed, which is what turns "it is broken" into "it broke between ' +
        'these two runs".',
      inputSchema: FailuresInputSchema,
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        return ok(formatFailures(await getFailures(input, { client })));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_flaky',
    {
      title: 'Test stability',
      description:
        'Test stability across recent runs, split three ways: flaky (genuinely alternating ' +
        'pass↔fail), regressed (passed then failed and stayed failed), and recovered. ' +
        'A test that fails every time is broken, a test that failed once and stayed failed is a ' +
        'regression, and only an alternating one is flaky — conflating them is how real regressions ' +
        'get dismissed as noise. Reads one request per run in parallel; a 10-run window is a few seconds.',
      inputSchema: StabilityInputSchema.extend({ project_id: projectField('Project to analyse') }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const project_id = client.requireProject(input.project_id);

        return ok(formatStability(await getStability({ ...input, project_id }, { client })));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_coverage',
    {
      title: 'Coverage gaps',
      description:
        'Where the test suite is thin: cases with no requirement reference, cases never executed in ' +
        'recent runs, priority and type distribution, and — if you name a run — which cases the run ' +
        'left untested. Answers "what are we not testing?".',
      inputSchema: CoverageInputSchema.extend({ project_id: projectField('Project to analyse') }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const project_id = client.requireProject(input.project_id);

        return ok(formatCoverage(await getCoverage({ ...input, project_id }, { client })));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_case',
    {
      title: 'Test case',
      description:
        'A test case in full: steps, preconditions, expected results and recent execution history. ' +
        'Use a case id found via testrail_search.',
      inputSchema: z.object({
        case_id: z.number().int().positive().describe('The case to read'),
        include_history: CaseDetailInputSchema.shape.include_history,
      }),
      annotations: READ_ONLY,
    },
    async (input) => {
      try {
        const detail = await getCaseDetail(
          { case_id: input.case_id, include_history: input.include_history },
          { client },
        );

        return ok(formatCaseDetail(detail));
      } catch (error) {
        return fail(error);
      }
    },
  );

  // Reading and writing a case are separate tools so a permission map can price
  // them apart: a reader holds testrail_case and never sees this one.
  server.registerTool(
    'testrail_case_write',
    {
      title: 'Create or update a test case',
      description: 'Create a test case in a section, or change fields on an existing one.' + writeNote,
      inputSchema: z.object({
        action: z.enum(['create', 'update']).describe('What to do'),
        case_id: z.number().int().positive().optional().describe('Required for update'),
        section_id: z.number().int().positive().optional().describe('Required for create'),
        ...CaseWriteFieldsSchema.shape,
      }),
      annotations: {
        // Creating and updating is neither read-only nor idempotent, and saying
        // so is what lets a client decide to ask a human first.
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        switch (input.action) {
          case 'create': {
            if (input.section_id === undefined) throw new Error('action:"create" needs a section_id.');
            const created = await createCase({ sectionId: input.section_id, fields: input }, { client });

            return ok(`Created case C${created.id} — ${created.title}\n${created.url}`);
          }

          case 'update': {
            if (input.case_id === undefined) throw new Error('action:"update" needs a case_id.');
            const updated = await updateCase({ caseId: input.case_id, fields: input }, { client });

            return ok(
              `Updated case C${updated.id} — ${updated.title}\nChanged: ${updated.changed.join(', ')}\n${updated.url}`,
            );
          }
        }
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_run',
    {
      title: 'Create, update or close a run',
      description:
        'Open a new test run, change its scope or name, or close it. ' +
        'Closing is permanent — TestRail archives the run and it can never be reopened.' +
        writeNote,
      inputSchema: z.object({
        action: z.enum(['create', 'update', 'close']).describe('What to do'),
        run_id: z.number().int().positive().optional().describe('Required for update and close'),
        project_id: projectField('Used by create'),
        ...RunWriteFieldsSchema.shape,
      }),
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        // `close` cannot be undone, so the tool as a whole is destructive.
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        switch (input.action) {
          case 'create': {
            const projectId = client.requireProject(input.project_id);
            const run = await createRun({ projectId, fields: input }, { client });

            return ok(`Created run ${run.id} — ${run.title}\n${run.url}`);
          }

          case 'update': {
            if (input.run_id === undefined) throw new Error('action:"update" needs a run_id.');
            const run = await updateRun({ runId: input.run_id, fields: input }, { client });

            return ok(`Updated run ${run.id} — ${run.title}\nChanged: ${run.changed.join(', ')}\n${run.url}`);
          }

          case 'close': {
            if (input.run_id === undefined) throw new Error('action:"close" needs a run_id.');
            const run = await closeRun({ runId: input.run_id }, { client });

            return ok(
              `Closed run ${run.id} — ${run.title}. This is permanent; the run is now archived.\n${run.url}`,
            );
          }
        }
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_report_result',
    {
      title: 'Report test results',
      description:
        'Post results for one or more cases in a run — the tool a CI job or an agent finishing a ' +
        'manual pass reaches for. Accepts a batch, so a whole suite is one call.' +
        writeNote,
      inputSchema: ReportResultsInputSchema,
      annotations: {
        readOnlyHint: false,
        idempotentHint: false,
        // Results append to a history rather than overwriting.
        destructiveHint: false,
        openWorldHint: true,
      },
    },
    async (input) => {
      try {
        const posted = await reportResults(input, { client });

        return ok(
          [
            `Posted ${posted.length} result${posted.length === 1 ? '' : 's'} to run ${input.run_id}.`,
            '',
            table(
              ['result', 'test', 'status'],
              posted.map((row) => [row.resultId, row.testId, row.status]),
            ),
            '',
            client.link('run', input.run_id),
          ].join('\n'),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    'testrail_raw',
    {
      title: 'Raw TestRail API call',
      description:
        'Call any TestRail API v2 endpoint directly. Use this ONLY when no other tool covers what ' +
        'you need — shared steps, datasets, configurations, attachments, reports, or instance-specific ' +
        'custom fields. Returns raw JSON, which is expensive; prefer the task tools where they fit. ' +
        "Endpoint is the part after /api/v2/, e.g. 'get_shared_steps/5'. TestRail joins extra query " +
        "parameters with & even for the first one: 'get_cases/5&suite_id=20&limit=10'.",
      inputSchema: RawInputSchema,
      annotations: {
        // This tool can reach write endpoints, so it cannot claim to be
        // read-only even though most calls through it will be reads.
        readOnlyHint: false,
        idempotentHint: false,
        destructiveHint: true,
        openWorldHint: true,
      },
    },
    async ({ endpoint, body, max_chars }) => {
      try {
        // Callers paste full URLs and leading slashes; normalise rather than 404.
        const path = endpoint.replace(/^https?:\/\/[^/]+\/index\.php\?/, '').replace(/^\/?(api\/v2\/)?/, '');

        if (body !== undefined && !isWriteEndpoint(path)) {
          // A body on a get_* endpoint is almost always a mistake, and TestRail
          // would silently ignore it rather than tell you.
          throw new Error(
            `'${path}' is a read endpoint but a body was supplied. Drop the body, or use the right endpoint.`,
          );
        }

        const data = await client.request<unknown>(path, body);

        return ok(
          [`\`${path}\``, '', '```json', truncate(JSON.stringify(data, null, 2), max_chars), '```'].join(
            '\n',
          ),
        );
      } catch (error) {
        return fail(error);
      }
    },
  );
}
