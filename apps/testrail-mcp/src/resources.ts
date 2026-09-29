import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/server';
import {
  loadMeta,
  recentRuns,
  type Milestone,
  type Project,
  type Run,
  type Section,
  type Suite,
  type TestRailClient,
  type Test,
} from 'testrail-ai';
import { clip, table, unixToDate } from 'testrail-ai/advanced';

/**
 * Browsable context, as resources rather than tools.
 *
 * The distinction matters and both existing TestRail MCP servers get it wrong by
 * having none: a tool is something the MODEL decides to call, spending a turn to
 * do it. A resource is something the CLIENT can attach up front, before the
 * conversation starts. "What projects exist?" and "what do the status ids mean?"
 * are pure lookups with no decision in them — paying a tool round-trip for that
 * is waste, and the ids are exactly what the model needs before it can call
 * anything useful.
 *
 * Cache hints (SEP-2549) are what make this cheap. Reference data carries an
 * hour-long public TTL, so a reconnecting client does not re-fetch it and the
 * upstream prompt cache stays stable across reconnects.
 */
export function registerResources(server: McpServer, client: TestRailClient): void {
  server.registerResource(
    'projects',
    'testrail://projects',
    {
      title: 'Projects',
      description: 'Every TestRail project, with its id and suite mode',
      mimeType: 'text/markdown',
      cacheHint: { ttlMs: 300_000, cacheScope: 'private' },
    },
    async (uri) => {
      const { rows } = await client.list<Project>('get_projects', 'projects', 250);

      const text = [
        `# TestRail projects (${rows.length})`,
        '',
        `Instance: ${client.instanceUrl}`,
        '',
        table(
          ['id', 'name', 'suite mode', 'status'],
          rows.map((row) => [
            row.id,
            row.name,
            row.suite_mode === 1 ? 'single suite' : row.suite_mode === 2 ? 'baselines' : 'multiple suites',
            row.is_completed ? 'completed' : 'active',
          ]),
        ),
      ].join('\n');

      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'meta',
    'testrail://meta',
    {
      title: 'Reference data',
      description: 'Status, priority, case type and user ids — the lookup tables every tool call needs',
      mimeType: 'text/markdown',
      // Reference data changes when an admin edits it, which is roughly never.
      cacheHint: { ttlMs: 3_600_000, cacheScope: 'private' },
    },
    async (uri) => {
      const meta = await loadMeta(client);

      const text = [
        '# TestRail reference data',
        '',
        '## Statuses',
        '',
        table(
          ['id', 'name', 'label', 'final', 'untested'],
          [...meta.statuses.values()].map((row) => [
            row.id,
            row.name,
            row.label,
            row.is_final ? 'yes' : '',
            row.is_untested ? 'yes' : '',
          ]),
        ),
        '',
        '## Priorities',
        '',
        table(
          ['id', 'name'],
          [...meta.priorities.values()].map((row) => [row.id, row.name]),
        ),
        '',
        '## Case types',
        '',
        table(
          ['id', 'name'],
          [...meta.caseTypes.values()].map((row) => [row.id, row.name]),
        ),
        '',
        `## Users (${meta.users.size})`,
        '',
        meta.users.size === 0
          ? '_The API key cannot list users (needs administrator rights). Reports look up the people they mention one at a time instead._'
          : table(
              ['id', 'name', 'email'],
              [...meta.users.values()].map((row) => [row.id, row.name, row.email]),
            ),
        '',
        `Writes are ${client.allowWrites ? '**enabled**' : '**disabled**'} on this server.`,
      ].join('\n');

      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'project',
    new ResourceTemplate('testrail://project/{projectId}', {
      list: async () => {
        const { rows } = await client.list<Project>('get_projects', 'projects', 250);

        return {
          resources: rows.map((row) => ({
            uri: `testrail://project/${row.id}`,
            name: row.name,
            description: `Suites, sections and recent runs for ${row.name}`,
            mimeType: 'text/markdown',
          })),
        };
      },
    }),
    {
      title: 'Project overview',
      description: 'Suites, sections, milestones and recent runs for one project',
      mimeType: 'text/markdown',
      cacheHint: { ttlMs: 60_000, cacheScope: 'private' },
    },
    async (uri, variables) => {
      const projectId = Number(variables.projectId);

      if (!Number.isInteger(projectId)) throw new Error(`Not a project id: ${String(variables.projectId)}`);

      const project = await client.request<Project>(`get_project/${projectId}`);

      const [suites, sections, milestones, runs] = await Promise.all([
        client
          .list<Suite>(`get_suites/${projectId}`, 'suites', 50)
          .catch(() => ({ rows: [], truncated: false })),
        client
          .list<Section>(`get_sections/${projectId}`, 'sections', 100)
          .catch(() => ({ rows: [], truncated: false })),
        client
          .list<Milestone>(`get_milestones/${projectId}`, 'milestones', 20)
          .catch(() => ({ rows: [], truncated: false })),
        recentRuns(client, { projectId, limit: 10 }).catch(() => ({
          rows: [],
          truncated: false,
          warnings: ['Recent runs could not be read.'],
        })),
      ]);

      const text = [
        `# ${project.name}`,
        '',
        `Project ${project.id} · ${project.suite_mode === 1 ? 'single suite' : project.suite_mode === 2 ? 'baselines' : 'multiple suites'} · ${project.is_completed ? 'completed' : 'active'}`,
        client.link('project', project.id),
        '',
        `## Suites (${suites.rows.length})`,
        '',
        table(
          ['id', 'name'],
          suites.rows.map((row) => [row.id, row.name]),
        ),
        '',
        `## Sections (${sections.rows.length})`,
        '',
        table(
          ['id', 'name', 'parent'],
          sections.rows.map((row) => [row.id, row.name, row.parent_id ?? '']),
        ),
        '',
        `## Milestones (${milestones.rows.length})`,
        '',
        table(
          ['id', 'name', 'due', 'status'],
          milestones.rows.map((row) => [
            row.id,
            row.name,
            unixToDate(row.due_on),
            row.is_completed ? 'complete' : 'open',
          ]),
        ),
        '',
        `## Recent runs (${runs.rows.length})`,
        '',
        table(
          ['id', 'name', 'created', 'passed', 'failed', 'blocked', 'untested'],
          runs.rows.map((row) => [
            row.id,
            clip(row.name, 60),
            unixToDate(row.created_on),
            row.passed_count,
            row.failed_count,
            row.blocked_count,
            row.untested_count,
          ]),
        ),
        ...runs.warnings.flatMap((warning) => ['', `> ⚠ ${warning}`]),
      ].join('\n');

      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );

  server.registerResource(
    'run',
    new ResourceTemplate('testrail://run/{runId}', { list: undefined }),
    {
      title: 'Run snapshot',
      description: 'Counts and per-test status for one run',
      mimeType: 'text/markdown',
      // An open run changes as testers work through it, so this must not be cached.
      cacheHint: { ttlMs: 0, cacheScope: 'private' },
    },
    async (uri, variables) => {
      const runId = Number(variables.runId);

      if (!Number.isInteger(runId)) throw new Error(`Not a run id: ${String(variables.runId)}`);

      const meta = await loadMeta(client);
      const run = await client.request<Run>(`get_run/${runId}`);
      const { rows: tests } = await client.list<Test>(`get_tests/${runId}`, 'tests', 500);

      await meta.nameUsers(tests.map((test) => test.assignedto_id));

      const text = [
        `# ${run.name}`,
        '',
        `Run ${run.id} · ${run.is_completed ? 'closed' : 'open'} · created ${unixToDate(run.created_on)}`,
        client.link('run', run.id),
        '',
        `${run.passed_count} passed · ${run.failed_count} failed · ${run.blocked_count} blocked · ${run.retest_count} retest · ${run.untested_count} untested`,
        '',
        `## Tests (${tests.length})`,
        '',
        table(
          ['case', 'title', 'status', 'assigned to'],
          tests.map((row) => [
            row.case_id,
            clip(row.title, 70),
            meta.statusName(row.status_id),
            meta.userName(row.assignedto_id),
          ]),
        ),
      ].join('\n');

      return { contents: [{ uri: uri.href, mimeType: 'text/markdown', text }] };
    },
  );
}
