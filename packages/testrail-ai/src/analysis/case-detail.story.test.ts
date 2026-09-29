import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, page } from '../test-support';
import { formatCaseDetail, getCaseDetail } from './case-detail';

/**
 * One case, made readable. TestRail stores it as HTML fragments under
 * instance-specific custom fields, so the fields are discovered, not listed.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const CASE = {
  id: 101,
  title: 'Login with SSO',
  section_id: 7,
  suite_id: 20,
  priority_id: 4,
  type_id: 9,
  refs: 'JIRA-12',
  estimate: '5m',
  template_id: 2,
  updated_on: 1_770_000_000,
  custom_preconds: '<p>A user with an <b>SSO</b> account</p>',
  custom_blank: '   ',
  custom_only_markup: '<p></p>',
  custom_automated: true,
  custom_components: [1, 2],
  custom_nothing: null,
  custom_steps_separated: [
    { content: '<p>Open login</p>', expected: 'Login page shown' },
    { content: 'Click SSO', expected: 'Redirected to IdP' },
  ],
};

describe('Reading a case', () => {
  it('renders rich text as text, structured steps as a table, and other fields as JSON', async ({ task }) => {
    story.init(task, { tags: ['case-detail'], covers: ['src/analysis/case-detail.ts'] });

    story.given('a case with HTML custom fields, a Steps template and non-text custom fields');

    const fake = fakeTestRail({
      'get_case/101': CASE,
      'get_section/7': { id: 7, name: 'Authentication' },
    });

    cleanup = fake.restore;

    story.when('it is read without history');

    const detail = await getCaseDetail(
      { case_id: 101, include_history: false },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('HTML is stripped and empty fields are dropped');
    expect(detail.richText).toEqual([{ name: 'preconds', text: 'A user with an SSO account' }]);

    story.and('non-text custom fields survive as JSON, but nulls and the steps array do not');
    expect(detail.otherFields).toEqual([
      { field: 'custom_automated', value: 'true' },
      { field: 'custom_components', value: '[1,2]' },
    ]);
    expect(detail).toMatchObject({
      sectionName: 'Authentication',
      priority: 'Critical',
      type: 'type:9',
      templateId: 2,
      updated: new Date(1_770_000_000_000).toISOString(),
      url: 'https://example.testrail.io/index.php?/cases/view/101',
      history: [],
    });

    story.and('no run is fetched when history was not asked for');
    expect(fake.calls.some((call) => call.startsWith('get_runs'))).toBe(false);

    const markdown = formatCaseDetail(detail);
    story.code({ label: 'Rendered', content: markdown, lang: 'markdown' });
    expect(markdown).toContain('# C101 — Login with SSO');
    expect(markdown).toContain('Authentication (7)');
    expect(markdown).toContain('## preconds');
    expect(markdown).toContain('## steps (structured)');
    expect(markdown).toContain('Redirected to IdP');
    expect(markdown).toContain('## Other custom fields');
    expect(markdown).not.toContain('## Recent executions');
  });

  it('walks recent runs for history, skipping runs without the case and results that fail to load', async ({
    task,
  }) => {
    story.init(task, { tags: ['case-detail', 'history'], covers: ['src/analysis/case-detail.ts'] });

    story.given('three recent runs: one ran the case, one did not include it, one has unreadable results');

    const fake = fakeTestRail({
      'get_case/101': CASE,
      'get_section/7': { id: 7, name: 'Authentication' },
      // get_case carries no project_id; the project comes from the suite.
      'get_suite/20': { id: 20, project_id: 5 },
      'get_plans/5': page('plans', []),
      'get_runs/5&suite_id=20': page('runs', [
        { id: 1, name: 'Nightly', created_on: 3 },
        { id: 2, name: 'Smoke', created_on: 2 },
        { id: 3, name: 'Release', created_on: 1 },
      ]),
      'get_tests/1': page('tests', [{ id: 11, case_id: 101, title: 'Login with SSO', status_id: 5 }]),
      'get_tests/2': page('tests', [{ id: 21, case_id: 999, title: 'Other', status_id: 1 }]),
      'get_tests/3': page('tests', [{ id: 31, case_id: 101, title: 'Login with SSO', status_id: 1 }]),
      'get_results/11': page('results', [
        { id: 1, test_id: 11, defects: 'BUG-7', comment: '<p>Timed out</p>' },
      ]),
      'get_results/31': () => new Response('boom', { status: 400 }),
    });

    cleanup = fake.restore;

    story.when('history is included (the default)');
    const detail = await getCaseDetail({ case_id: 101 }, { client: fake.client, meta: FAKE_META });

    story.then('only runs that contained the case appear, with the latest result where it loaded');
    story.json({ label: 'History', value: detail.history });
    expect(detail.history).toEqual([
      { runId: 1, runName: 'Nightly', status: 'failed', defects: 'BUG-7', comment: 'Timed out' },
      { runId: 3, runName: 'Release', status: 'passed', defects: '', comment: '' },
    ]);

    const markdown = formatCaseDetail(detail);
    expect(markdown).toContain('## Recent executions');
    expect(markdown).toContain('BUG-7');
  });

  it('warns when the case may be in the part of a run it could not read', async ({ task }) => {
    story.init(task, { tags: ['case-detail', 'history', 'pagination'] });

    story.given('a run with more than 2000 tests, none of the first 2000 being C101');

    const others = Array.from({ length: 2000 }, (_, index) => ({
      id: index + 1,
      case_id: 5000 + index,
      title: 'Other',
      status_id: 1,
    }));

    const fake = fakeTestRail({
      'get_case/101': CASE,
      'get_section/7': { id: 7, name: 'Authentication' },
      'get_suite/20': { id: 20, project_id: 5 },
      'get_plans/5': page('plans', []),
      'get_runs/5&suite_id=20': page('runs', [{ id: 1, name: 'Huge', created_on: 1 }]),
      'get_tests/1': page('tests', others, '/api/v2/get_tests/1&limit=250&offset=2000'),
    });

    cleanup = fake.restore;

    const detail = await getCaseDetail({ case_id: 101 }, { client: fake.client, meta: FAKE_META });

    story.then('the empty history is marked incomplete, naming the run');
    expect(detail.history).toEqual([]);
    expect(detail.complete).toBe(false);
    expect(detail.warnings).toEqual(['Run 1 has more than 2000 tests; C101 may be in the part not read.']);
  });

  it('degrades when the section is unreadable and the case has no project', async ({ task }) => {
    story.init(task, { tags: ['case-detail', 'resilience'], covers: ['src/analysis/case-detail.ts'] });

    story.given('a sparse case whose section lookup fails');

    const fake = fakeTestRail({
      'get_case/102': {
        id: 102,
        title: 'Bare',
        section_id: 8,
        priority_id: 2,
        type_id: 1,
        refs: null,
        estimate: null,
        updated_on: null,
      },
      'get_section/8': () => new Response('forbidden', { status: 403 }),
    });

    cleanup = fake.restore;

    story.when('it is read with history');

    const detail = await getCaseDetail(
      { case_id: 102, include_history: true },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the section falls back to its id, and history is empty without a project to search');
    expect(detail).toMatchObject({
      sectionName: null,
      templateId: null,
      updated: null,
      structuredSteps: undefined,
      history: [],
    });
    expect(fake.calls.some((call) => call.startsWith('get_runs'))).toBe(false);

    story.and('the report says what it could not read');
    expect(detail.complete).toBe(false);
    expect(detail.warnings).toEqual([
      'Section 8 could not be read; showing its id.',
      'History skipped: the case names no suite to find its project from.',
    ]);

    const markdown = formatCaseDetail(detail);
    expect(markdown).toContain('> ⚠ Section 8 could not be read');
    expect(markdown).toContain('| section | 8 |');
    expect(markdown).toContain('| refs | — |');
    expect(markdown).not.toContain('## steps (structured)');
  });

  it('still reads the case when its suite cannot be read for history', async ({ task }) => {
    story.init(task, {
      tags: ['case-detail', 'history', 'resilience'],
      covers: ['src/analysis/case-detail.ts'],
    });

    story.given('a case whose suite lookup is forbidden');

    const fake = fakeTestRail({
      'get_case/101': CASE,
      'get_section/7': { id: 7, name: 'Authentication' },
      'get_suite/20': () => new Response('forbidden', { status: 403 }),
    });

    cleanup = fake.restore;

    story.when('it is read with history');

    const detail = await getCaseDetail(
      { case_id: 101, include_history: true },
      { client: fake.client, meta: FAKE_META },
    );

    story.then('the case comes back with no history, and no runs are listed');
    expect(detail.title).toBe('Login with SSO');
    expect(detail.history).toEqual([]);
    expect(fake.calls.some((call) => call.startsWith('get_runs'))).toBe(false);
    expect(detail.warnings).toEqual(['History skipped: suite 20 could not be read.']);
  });

  it('rejects an invalid case id before calling TestRail', async ({ task }) => {
    story.init(task, { tags: ['case-detail', 'validation'], covers: ['src/analysis/case-detail.ts'] });
    const fake = fakeTestRail({});
    cleanup = fake.restore;

    await expect(
      getCaseDetail({ case_id: 0, include_history: false }, { client: fake.client }),
    ).rejects.toThrow(/"case_id"/);
    expect(fake.calls).toEqual([]);
  });
});
