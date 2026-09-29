import { completable, type McpServer } from '@modelcontextprotocol/server';
import type { Project, TestRailClient } from 'testrail-ai';
import { z } from 'zod';

/**
 * Prompts are the workflows a QA lead runs on a schedule, offered as a menu.
 *
 * The distinction from tools is who chooses: a tool is picked by the model
 * mid-reasoning, a prompt is picked by a HUMAN from a list — the `/` menu in
 * Claude Desktop, a slash command in Claude Code. That is why prompts get
 * argument completion and tools do not, and why "summarise last night's
 * regression" belongs here rather than as a tenth tool.
 *
 * Each prompt does the same thing: it tells the model which of the ten tools to
 * use, in what order, and what a good answer looks like. That is a lot of
 * per-task guidance that no longer has to live in every tool description, where
 * it would cost tokens on every single turn.
 */
export function registerPrompts(server: McpServer, client: TestRailClient): void {
  // Completion over real project names, so the human picking the prompt does not
  // have to go and look up an id first.
  const completeProject = completable(
    z.string().describe('Project id, or part of the project name'),
    async (value) => {
      try {
        const { rows } = await client.list<Project>('get_projects', 'projects', 250);

        return rows
          .filter(
            (row) => String(row.id).startsWith(value) || row.name.toLowerCase().includes(value.toLowerCase()),
          )
          .map((row) => `${row.id}`)
          .slice(0, 20);
      } catch {
        return [];
      }
    },
  );

  server.registerPrompt(
    'triage_run',
    {
      title: 'Triage a test run',
      description: "Work through a run's failures, cluster them by cause, and propose next actions",
      argsSchema: z.object({
        run_id: z.string().describe('The run to triage'),
      }),
    },
    ({ run_id }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Triage TestRail run ${run_id}.

Do this in order:
1. \`testrail_run_report\` with run_id ${run_id} — read the totals and the failure clusters.
2. \`testrail_failures\` with run_id ${run_id} and include_last_good true — get the comments, defects, and when each case last passed.
3. For any case whose failure is unclear, \`testrail_case\` with action "get" to read its steps and expected result.

Then report:

**Verdict** — one line: is this run releasable, and if not, what blocks it.

**Clusters** — group the failures by root cause, not by test name. For each: how many tests, the shared symptom, and your best guess at the cause. Say when you are guessing.

**Regressions vs. known** — separate cases that passed in a recent run (something broke) from cases that have been failing for a while (known debt).

**Actions** — a short list, each naming a specific case id and who or what needs to act.

Do not restate the pass/fail numbers as prose; the table already says them. Cite case ids as C123 so they are searchable.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'regression_summary',
    {
      title: 'Regression summary',
      description: 'A stakeholder-ready summary of recent test activity in a project',
      argsSchema: z.object({
        project_id: completeProject,
        runs: z.string().describe('How many recent runs to cover, e.g. 5').optional(),
      }),
    },
    ({ project_id, runs }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Write a regression summary for TestRail project ${project_id} covering the last ${runs ?? '5'} runs.

Gather:
1. \`testrail_search\` entity "runs", project_id ${project_id}, limit ${runs ?? '5'} — the runs and their headline counts.
2. \`testrail_run_report\` on the most recent run — the current state in detail.
3. \`testrail_flaky\` with project_id ${project_id} and runs ${runs ?? '5'} — separate genuine failures from noise.

Then write for someone who will not open TestRail:

**Where we are** — two or three sentences. Pass rate trend across the runs: improving, flat, or degrading.

**What is broken** — real, reproducible failures. Name them by case id and say what the user-visible impact is.

**What is noise** — flaky tests, with how often they flip. Be explicit that these are not evidence of a regression, and that they are costing signal.

**Trend table** — run, date, pass rate, failures.

**Recommendation** — ship / hold / conditional, and the condition.

Keep it under 400 words. No filler, no restating the brief.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'coverage_gap',
    {
      title: 'Find coverage gaps',
      description: 'Analyse what a project is not testing, and what to write next',
      argsSchema: z.object({
        project_id: completeProject,
        refs: z
          .string()
          .describe('Optional comma-separated requirement keys to check for coverage, e.g. RP-100,RP-101')
          .optional(),
      }),
    },
    ({ project_id, refs }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text: `Analyse test coverage for TestRail project ${project_id}.

Run \`testrail_coverage\` with project_id ${project_id}${
              refs
                ? `, refs [${refs
                    .split(',')
                    .map((r) => `"${r.trim()}"`)
                    .join(', ')}]`
                : ''
            }, and recent_runs 5.

Then answer:

**Biggest gap** — the single most important thing this project is not testing, and why you picked it over the others.

**Untraceable cases** — how many cases have no requirement reference, and whether that is a process problem or just old cases.

**Dead cases** — cases that exist but never execute. For each, a call: revive, automate, or delete. A case that has not run in months is not coverage, it is inventory.

**Distribution** — is the priority spread plausible, or is everything Medium? A suite where nothing is Critical has not been prioritised.

**Write next** — three to five concrete test cases worth adding, each with a title, the gap it closes, and a suggested priority.

Ground every claim in the numbers the tool returned. If the data does not support a conclusion, say so instead of filling the space.`,
          },
        },
      ],
    }),
  );
}
