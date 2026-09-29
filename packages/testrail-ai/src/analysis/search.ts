import { appendQuery, type TestRailClient } from '../client';
import { resolveMeta, type TestRailDeps } from '../deps';
import { clip, table, toUnix, unixToDate } from '../format';
import type { z } from 'zod';
import { SearchInputSchema, type Entity, type SearchInput } from '../schemas';
import type { Case, Milestone, Plan, Project, Section, Suite, Test } from '../types';
import { completeness, warningLines, type Completeness } from '../completeness';
import { recentRuns } from './runs';

/**
 * One search across every entity, instead of eight near-identical getters.
 *
 * The saving is not cosmetic. As MCP tools, eight getters is eight JSON schemas
 * in the model's context on every turn; as CLI commands it is eight help pages.
 * One entity enum is a fraction of the surface and strictly easier to pick.
 */

export type SearchResult = Completeness & {
  entity: Entity;
  count: number;
  columns: string[];
  rows: (string | number)[][];
  /** Guidance for the next step, separate from the warnings. */
  note?: string;
  /** The untouched TestRail entities, for callers that want the data not the table. */
  raw: unknown[];
};

type SearchRows = Omit<SearchResult, keyof Completeness> & { truncated: boolean; warnings?: string[] };

export async function search(input: SearchInput, deps: TestRailDeps): Promise<SearchResult> {
  const args = SearchInputSchema.parse(input);
  const { truncated, warnings = [], ...result } = await searchRows(args, deps);

  // Cases are filtered by TestRail, so the cap is on matches; everything else is
  // matched here, so the cap is on the rows read before matching.
  const capped =
    args.entity === 'cases'
      ? `Capped at ${args.limit} rows — narrow the filters or raise the limit.`
      : `Capped at ${args.limit} source rows — raise the limit to search the remainder.`;

  return { ...result, ...completeness(truncated && capped, ...warnings) };
}

async function searchRows(args: z.output<typeof SearchInputSchema>, deps: TestRailDeps): Promise<SearchRows> {
  const { client } = deps;
  const { entity, limit } = args;

  if (!['projects', 'tests'].includes(entity) && args.project_id === undefined) {
    throw new Error(`entity '${entity}' needs a project_id. Search entity:'projects' first.`);
  }

  if (entity === 'tests' && args.run_id === undefined) {
    throw new Error("entity 'tests' needs a run_id. Search entity:'runs' first.");
  }

  const meta = await resolveMeta(deps);

  // Title matching: `get_cases` supports a server-side `filter`, nothing else
  // does, so everything else is matched client-side after the fetch.
  const match = (text: string) => !args.query || text.toLowerCase().includes(args.query.toLowerCase());

  const unixParam = (name: string, value: string | undefined) => {
    const unix = toUnix(value);

    return unix === undefined ? undefined : `${name}=${unix}`;
  };

  switch (entity) {
    case 'projects': {
      const { rows, truncated } = await client.list<Project>('get_projects', 'projects', limit);
      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        columns: ['id', 'name', 'suite mode', 'completed'],
        rows: hits.map((row) => [
          row.id,
          row.name,
          row.suite_mode === 1 ? 'single' : row.suite_mode === 2 ? 'baselines' : 'multiple',
          row.is_completed ? 'yes' : '',
        ]),
      };
    }

    case 'suites': {
      const { rows, truncated } = await client.list<Suite>(`get_suites/${args.project_id}`, 'suites', limit);
      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        columns: ['id', 'name', 'description'],
        rows: hits.map((row) => [row.id, row.name, clip(row.description ?? '', 120)]),
      };
    }

    case 'sections': {
      const { rows, truncated } = await client.list<Section>(
        appendQuery(`get_sections/${args.project_id}`, args.suite_id ? `suite_id=${args.suite_id}` : ''),
        'sections',
        limit,
      );

      const paths = sectionPaths(rows);
      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        note: "Pass a path as section_path to list a section's cases.",
        columns: ['id', 'name', 'path'],
        rows: hits.map((row) => [row.id, row.name, paths.get(row.id) ?? row.name]),
      };
    }

    case 'cases': {
      const sectionId =
        args.section_path === undefined
          ? args.section_id
          : await resolveSectionPath(client, args.project_id!, args.suite_id, args.section_path);

      const filters = [
        args.suite_id && `suite_id=${args.suite_id}`,
        sectionId && `section_id=${sectionId}`,
        args.priority_id && `priority_id=${args.priority_id}`,
        args.type_id && `type_id=${args.type_id}`,
        args.refs && `refs=${encodeURIComponent(args.refs)}`,
        args.label_id?.length && `label_id=${args.label_id.join(',')}`,
        unixParam('created_after', args.created_after),
        unixParam('updated_after', args.updated_after),
        // The one entity where TestRail filters titles for us.
        args.query && `filter=${encodeURIComponent(args.query)}`,
      ].filter((part): part is string => Boolean(part));

      const { rows, truncated } = await client.list<Case>(
        appendQuery(`get_cases/${args.project_id}`, filters.join('&')),
        'cases',
        limit,
      );

      return {
        entity,
        count: rows.length,
        truncated,
        raw: rows,
        columns: ['id', 'title', 'priority', 'type', 'refs', 'updated'],
        rows: rows.map((row) => [
          row.id,
          clip(row.title, 90),
          meta.priorityName(row.priority_id),
          meta.typeName(row.type_id),
          row.refs ?? '',
          unixToDate(row.updated_on),
        ]),
      };
    }

    case 'runs': {
      // Through `recentRuns`, so runs inside test plans are found here too.
      const { rows, truncated, warnings } = await recentRuns(client, {
        projectId: args.project_id!,
        suiteId: args.suite_id,
        milestoneId: args.milestone_id,
        isCompleted: args.is_completed,
        createdAfter: toUnix(args.created_after),
        limit,
      });

      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        warnings,
        raw: hits,
        note: 'Use the run report with a run id for the breakdown.',
        columns: ['id', 'name', 'created', 'passed', 'failed', 'blocked', 'untested', 'status'],
        rows: hits.map((row) => [
          row.id,
          clip(row.name, 70),
          unixToDate(row.created_on),
          row.passed_count,
          row.failed_count,
          row.blocked_count,
          row.untested_count,
          row.is_completed ? 'closed' : 'open',
        ]),
      };
    }

    case 'plans': {
      const filters = [
        args.milestone_id && `milestone_id=${args.milestone_id}`,
        args.is_completed !== undefined && `is_completed=${args.is_completed ? 1 : 0}`,
        unixParam('created_after', args.created_after),
      ].filter((part): part is string => Boolean(part));

      const { rows, truncated } = await client.list<Plan>(
        appendQuery(`get_plans/${args.project_id}`, filters.join('&')),
        'plans',
        limit,
      );

      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        columns: ['id', 'name', 'created', 'status'],
        rows: hits.map((row) => [
          row.id,
          clip(row.name, 80),
          unixToDate(row.created_on),
          row.is_completed ? 'closed' : 'open',
        ]),
      };
    }

    case 'milestones': {
      const { rows, truncated } = await client.list<Milestone>(
        appendQuery(
          `get_milestones/${args.project_id}`,
          args.is_completed === undefined ? '' : `is_completed=${args.is_completed ? 1 : 0}`,
        ),
        'milestones',
        limit,
      );

      const hits = rows.filter((row) => match(row.name));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        columns: ['id', 'name', 'due', 'status'],
        rows: hits.map((row) => [
          row.id,
          row.name,
          unixToDate(row.due_on),
          row.is_completed ? 'complete' : 'open',
        ]),
      };
    }

    case 'tests': {
      const { rows, truncated } = await client.list<Test>(
        appendQuery(
          `get_tests/${args.run_id}`,
          args.status_id?.length ? `status_id=${args.status_id.join(',')}` : '',
        ),
        'tests',
        limit,
      );

      const hits = rows.filter((row) => match(row.title));

      await meta.nameUsers(hits.map((row) => row.assignedto_id));

      return {
        entity,
        count: hits.length,
        truncated,
        raw: hits,
        columns: ['id', 'case', 'title', 'status', 'assigned to'],
        rows: hits.map((row) => [
          row.id,
          row.case_id,
          clip(row.title, 80),
          meta.statusName(row.status_id),
          meta.userName(row.assignedto_id),
        ]),
      };
    }
  }
}

const TITLES: Record<Entity, string> = {
  projects: 'Projects',
  suites: 'Suites',
  sections: 'Sections',
  cases: 'Cases',
  runs: 'Runs',
  plans: 'Test plans',
  milestones: 'Milestones',
  tests: 'Tests',
};

export function formatSearch(result: SearchResult): string {
  return [
    `## ${TITLES[result.entity]} (${result.count})`,
    '',
    table(result.columns, result.rows),
    ...warningLines(result),
    result.note ? `\n_${result.note}_` : '',
  ]
    .join('\n')
    .trimEnd();
}

/** Each section's full path, `Parent > Child`, from one project's section list. */
function sectionPaths(sections: Section[]): Map<number, string> {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const paths = new Map<number, string>();

  const pathOf = (section: Section): string => {
    const known = paths.get(section.id);

    if (known !== undefined) return known;

    const parent = section.parent_id == null ? undefined : byId.get(section.parent_id);
    const path = parent ? `${pathOf(parent)} > ${section.name}` : section.name;
    paths.set(section.id, path);

    return path;
  };

  for (const section of sections) pathOf(section);

  return paths;
}

/**
 * The section a path names, so a person can say where cases live rather than
 * look up an id. The full path wins; otherwise a trailing part that names
 * exactly one section. Anything else is an error that lists the candidates.
 */
async function resolveSectionPath(
  client: TestRailClient,
  projectId: number,
  suiteId: number | undefined,
  sectionPath: string,
): Promise<number> {
  let wanted = splitPath(sectionPath);

  if (wanted.length === 0) throw new Error('section_path is empty.');

  // A project with several suites keeps a section tree per suite, so without a
  // suite_id the path starts with the suite's name.
  if (suiteId === undefined) {
    const { rows: suites } = await client.list<Suite>(`get_suites/${projectId}`, 'suites', 250);

    if (suites.length > 1) {
      const suite = suites.find((candidate) => candidate.name.trim().toLowerCase() === wanted[0]);

      if (!suite || wanted.length < 2) {
        throw new Error(
          `Project ${projectId} has ${suites.length} suites; start section_path with one of them, ` +
            `e.g. '${suites[0]!.name} > …', or pass suite_id.\n` +
            suites.map((candidate) => `  ${candidate.id}: ${candidate.name}`).join('\n'),
        );
      }

      suiteId = suite.id;
      wanted = wanted.slice(1);
    }
  }

  const { rows, truncated } = await client.list<Section>(
    appendQuery(`get_sections/${projectId}`, suiteId ? `suite_id=${suiteId}` : ''),
    'sections',
    SECTION_LIMIT,
  );

  const paths = [...sectionPaths(rows)].map(([id, path]) => ({ id, path, parts: splitPath(path) }));

  const same = (a: string[], b: string[]) =>
    a.length === b.length && a.every((part, index) => part === b[index]);

  const exact = paths.filter((candidate) => same(candidate.parts, wanted));

  const matches =
    exact.length > 0
      ? exact
      : paths.filter((candidate) => same(candidate.parts.slice(-wanted.length), wanted));

  if (matches.length === 1) return matches[0]!.id;

  const scope = `project ${projectId}${suiteId ? `, suite ${suiteId}` : ''}`;
  const capped = truncated ? ` Only the first ${SECTION_LIMIT} sections were read.` : '';

  if (matches.length > 1) {
    throw new Error(
      `'${sectionPath}' matches ${matches.length} sections in ${scope}; give more of the path.${capped}\n` +
        matches.map((match) => `  ${match.id}: ${match.path}`).join('\n'),
    );
  }

  const last = wanted.at(-1)!;
  const near = paths.filter((candidate) => candidate.parts.at(-1)?.includes(last)).slice(0, 10);

  throw new Error(
    `No section '${sectionPath}' in ${scope}.${capped}` +
      (near.length > 0
        ? `\nSimilar:\n${near.map((match) => `  ${match.id}: ${match.path}`).join('\n')}`
        : ''),
  );
}

/** Path parts compared without case or surrounding spaces. */
function splitPath(path: string): string[] {
  return path
    .split('>')
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
}

const SECTION_LIMIT = 2000;
