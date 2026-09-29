import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_META, fakeTestRail, sentBody } from '../test-support';
import type { Json } from '../types';
import {
  caseBody,
  closeRun,
  createCase,
  createRun,
  reportResults,
  runBody,
  updateCase,
  updateRun,
} from './index';

/**
 * Writes are the paths that cannot be rehearsed against someone's production
 * TestRail, so the payload-building is tested exhaustively here instead.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('Write target validation', () => {
  it('rejects invalid ids before any TestRail request', async ({ task }) => {
    story.init(task, { tags: ['writes', 'validation', 'safety'], covers: ['src/write/index.ts'] });
    const fake = fakeTestRail({}, { allowWrites: true });

    await expect(
      createCase({ sectionId: 0, fields: { title: 'Invalid' } }, { client: fake.client }),
    ).rejects.toThrow(/"sectionId"/);
    await expect(closeRun({ runId: -1 }, { client: fake.client })).rejects.toThrow(/"runId"/);
    expect(fake.calls).toEqual([]);
  });
});

describe('Building a case payload', () => {
  it('sends only the fields the caller actually supplied', ({ task }) => {
    story.init(task, { tags: ['writes', 'safety'], covers: ['src/write/index.ts'] });

    story.given('an update that changes only the title');
    story.when('the payload is built');
    const body = caseBody({ title: 'New title' });
    story.json({ label: 'Payload', value: body });

    story.then('the payload contains exactly one key');
    story.note(
      'TestRail treats a present key as an instruction. Sending undefined fields would blank out ' +
        'the steps, refs and estimate the caller never mentioned.',
    );
    expect(Object.keys(body)).toEqual(['title']);
  });

  it('maps friendly names onto TestRail custom fields', ({ task }) => {
    story.init(task, { tags: ['writes'] });

    story.given('steps, preconditions and expected results');
    story.when('the payload is built');
    const body = caseBody({ steps: 'do it', preconditions: 'be ready', expected: 'it worked' });
    story.json({ label: 'Payload', value: body });

    story.then("they land under TestRail's custom_ names");
    expect(body).toEqual({
      custom_steps: 'do it',
      custom_preconds: 'be ready',
      custom_expected: 'it worked',
    });
  });

  it('supports the structured steps a Steps-template case needs', ({ task }) => {
    story.init(task, { tags: ['writes'], covers: ['src/write/index.ts'] });

    story.given('a case using template 2, with structured steps');
    story.note(
      'Sending structured steps to a Text-template case is accepted by the API and silently ' +
        'renders nothing — hence the explicit template_id.',
    );
    story.when('the payload is built');

    const body = caseBody({
      template_id: 2,
      steps_separated: [{ content: 'Click login', expected: 'Form appears' }, { content: 'Submit' }],
    });

    story.json({ label: 'Payload', value: body });

    story.then('the steps go under custom_steps_separated');
    expect(body.template_id).toBe(2);

    story.and('every row carries an expected value, even when it was omitted');
    expect(body.custom_steps_separated).toEqual([
      { content: 'Click login', expected: 'Form appears' },
      { content: 'Submit', expected: '' },
    ]);
  });

  it('passes instance-specific custom fields straight through', ({ task }) => {
    story.init(task, { tags: ['writes'] });
    story.given('a field that only exists on this TestRail instance');
    story.when('the payload is built');
    const body = caseBody({ title: 'x', custom_fields: { custom_automation_type: 2 } });
    story.then('it is sent verbatim alongside the known fields');
    expect(body).toEqual({ title: 'x', custom_automation_type: 2 });
  });

  it('refuses custom-field entries that can overwrite standard fields', ({ task }) => {
    story.init(task, { tags: ['writes', 'validation', 'safety'] });

    expect(() => caseBody({ title: 'Safe', custom_fields: { title: 'Overridden' } })).toThrow(/custom_/);
  });
});

describe('Building a run payload', () => {
  it('pairs a case list with include_all false', ({ task }) => {
    story.init(task, { tags: ['writes'], covers: ['src/write/index.ts'] });

    story.given('a run scoped to three specific cases');
    story.when('the payload is built');
    const body = runBody({ name: 'Smoke', case_ids: [1, 2, 3] });
    story.json({ label: 'Payload', value: body });

    story.then('include_all is forced false');
    story.note(
      'TestRail ignores case_ids unless include_all is false — the run would silently include everything.',
    );
    expect(body.include_all).toBe(false);
    expect(body.case_ids).toEqual([1, 2, 3]);
  });

  it('keeps an explicitly empty case list', ({ task }) => {
    story.init(task, { tags: ['writes'] });

    story.given('a run created with case_ids: []');
    const body = runBody({ name: 'Empty', case_ids: [] });

    story.then('it stays an empty run rather than becoming one with every case');
    expect(body).toEqual({ name: 'Empty', include_all: false, case_ids: [] });
  });

  it('carries refs and config ids', ({ task }) => {
    story.init(task, { tags: ['writes'] });
    story.given('a run linked to a requirement and a configuration');
    story.when('the payload is built');
    const body = runBody({ name: 'Smoke', refs: 'CUR-5497', config_ids: [4] });
    story.then('both reach TestRail');
    expect(body.refs).toBe('CUR-5497');
    expect(body.config_ids).toEqual([4]);
  });
});

describe('Guarding the write paths', () => {
  it('refuses to create a case without a title', async ({ task }) => {
    story.init(task, { tags: ['writes', 'validation'] });
    const fake = fakeTestRail({ add_case: { id: 1 } }, { allowWrites: true });
    cleanup = fake.restore;

    story.given('a create with no title');
    story.when('it is attempted');
    story.then('it fails before reaching TestRail');
    await expect(createCase({ sectionId: 10, fields: {} }, { client: fake.client })).rejects.toThrow(
      /needs a title/,
    );
    expect(fake.calls).toEqual([]);
  });

  it('refuses an update that would change nothing', async ({ task }) => {
    story.init(task, { tags: ['writes', 'validation'] });
    const fake = fakeTestRail({ update_case: { id: 1 } }, { allowWrites: true });
    cleanup = fake.restore;

    story.given('an update with no fields set');
    story.when('it is attempted');
    story.then('it fails rather than sending an empty payload');
    story.note(
      'An empty update is always a caller mistake; sending it wastes a round trip and hides the bug.',
    );
    await expect(updateCase({ caseId: 5, fields: {} }, { client: fake.client })).rejects.toThrow(
      /at least one field/,
    );
    expect(fake.calls).toEqual([]);
  });

  it('explains why "untested" cannot be posted as a result', async ({ task }) => {
    story.init(task, { tags: ['writes', 'validation'], covers: ['src/write/index.ts'] });

    story.given('an attempt to mark two cases untested');
    const fake = fakeTestRail({ add_results_for_cases: [] }, { allowWrites: true });
    cleanup = fake.restore;

    story.when('the results are posted');
    story.then('it is rejected with the reason, naming the offending cases');
    story.note(
      'TestRail would answer an opaque 400. Untested is the absence of a result, not a result — ' +
        'you remove the result instead.',
    );
    await expect(
      reportResults(
        {
          run_id: 1,
          results: [
            { case_id: 10, status: 'untested' },
            { case_id: 11, status: 'untested' },
          ],
        },
        { client: fake.client, meta: FAKE_META },
      ),
    ).rejects.toThrow(/cases 10, 11/);

    story.and('no request was made');
    expect(fake.calls).toEqual([]);
  });

  it('maps status names to TestRail ids when posting', async ({ task }) => {
    story.init(task, { tags: ['writes'] });

    story.given('a batch of results using human status names');
    let sent: Json = null;

    const fake = fakeTestRail(
      {
        add_results_for_cases: (_url: string, init: RequestInit | undefined) => {
          sent = sentBody(init);

          return [{ id: 900, test_id: 1, status_id: 5 }];
        },
      },
      { allowWrites: true },
    );

    cleanup = fake.restore;

    story.when('they are posted');

    const posted = await reportResults(
      {
        run_id: 1,
        results: [{ case_id: 10, status: 'failed', comment: 'broke', defects: 'CUR-1' }],
      },
      { client: fake.client, meta: FAKE_META },
    );

    story.json({ label: 'Sent to TestRail', value: sent });

    story.then("'failed' becomes status_id 5");
    expect(sent).toEqual({
      results: [{ case_id: 10, status_id: 5, comment: 'broke', defects: 'CUR-1' }],
    });

    story.and('the outcome comes back with the status name resolved again');
    expect(posted).toEqual([{ resultId: 900, testId: 1, status: 'failed' }]);
  });

  it('reports closing a run as the irreversible act it is', async ({ task }) => {
    story.init(task, { tags: ['writes', 'safety'] });

    story.given('a run being closed');
    const fake = fakeTestRail({ close_run: { id: 612, name: 'Regression' } }, { allowWrites: true });
    cleanup = fake.restore;

    story.when('the close succeeds');
    const outcome = await closeRun({ runId: 612 }, { client: fake.client });

    story.then('the outcome names the run and links to it');
    expect(outcome).toMatchObject({ id: 612, title: 'Regression' });
    expect(outcome.url).toContain('/runs/view/612');
  });
});

/** A route that records the JSON body TestRail was sent, then answers with `reply`. */
function capture(reply: Json) {
  const sent: Json[] = [];

  const route = (_url: string, init: RequestInit | undefined) => {
    sent.push(sentBody(init));

    return reply;
  };

  return { sent, route };
}

describe('Carrying out writes', () => {
  it('creates a case in a section and reports what it set', async ({ task }) => {
    story.init(task, { tags: ['writes'], covers: ['src/write/index.ts'] });
    const add = capture({ id: 77, title: 'Login works' });
    const fake = fakeTestRail({ 'add_case/10': add.route }, { allowWrites: true });
    cleanup = fake.restore;

    const outcome = await createCase(
      { sectionId: 10, fields: { title: 'Login works', priority_id: 3, refs: 'JIRA-1' } },
      { client: fake.client },
    );

    expect(add.sent).toEqual([{ title: 'Login works', priority_id: 3, refs: 'JIRA-1' }]);
    expect(outcome).toEqual({
      id: 77,
      title: 'Login works',
      url: 'https://example.testrail.io/index.php?/cases/view/77',
      changed: ['title', 'priority_id', 'refs'],
    });
  });

  it('updates only the case fields supplied', async ({ task }) => {
    story.init(task, { tags: ['writes', 'safety'], covers: ['src/write/index.ts'] });
    const update = capture({ id: 5, title: 'Renamed' });
    const fake = fakeTestRail({ 'update_case/5': update.route }, { allowWrites: true });
    cleanup = fake.restore;

    const outcome = await updateCase(
      { caseId: 5, fields: { type_id: 2, estimate: '5m', milestone_id: 9 } },
      { client: fake.client },
    );

    expect(update.sent).toEqual([{ type_id: 2, estimate: '5m', milestone_id: 9 }]);
    expect(outcome).toMatchObject({
      id: 5,
      title: 'Renamed',
      changed: ['type_id', 'estimate', 'milestone_id'],
    });
  });

  it('creates a run from every run field', async ({ task }) => {
    story.init(task, { tags: ['writes', 'runs'], covers: ['src/write/index.ts'] });
    const add = capture({ id: 700, name: 'Smoke' });
    const fake = fakeTestRail({ 'add_run/5': add.route }, { allowWrites: true });
    cleanup = fake.restore;

    const outcome = await createRun(
      {
        projectId: 5,
        fields: {
          name: 'Smoke',
          description: 'Before release',
          suite_id: 2,
          milestone_id: 9,
          assignedto_id: 3,
          include_all: true,
        },
      },
      { client: fake.client },
    );

    expect(add.sent).toEqual([
      {
        name: 'Smoke',
        description: 'Before release',
        suite_id: 2,
        milestone_id: 9,
        assignedto_id: 3,
        include_all: true,
      },
    ]);
    expect(outcome).toEqual({
      id: 700,
      title: 'Smoke',
      url: 'https://example.testrail.io/index.php?/runs/view/700',
      changed: ['name', 'description', 'suite_id', 'milestone_id', 'assignedto_id', 'include_all'],
    });
  });

  it('refuses to create a run without a name', async ({ task }) => {
    story.init(task, { tags: ['writes', 'runs', 'validation'] });
    const fake = fakeTestRail({}, { allowWrites: true });
    cleanup = fake.restore;

    await expect(createRun({ projectId: 5, fields: {} }, { client: fake.client })).rejects.toThrow(
      'Creating a run needs a name.',
    );
    expect(fake.calls).toEqual([]);
  });

  it('updates a run, and refuses an update that changes nothing', async ({ task }) => {
    story.init(task, { tags: ['writes', 'runs'], covers: ['src/write/index.ts'] });
    const update = capture({ id: 700, name: 'Renamed' });
    const fake = fakeTestRail({ 'update_run/700': update.route }, { allowWrites: true });
    cleanup = fake.restore;

    const outcome = await updateRun({ runId: 700, fields: { name: 'Renamed' } }, { client: fake.client });
    expect(update.sent).toEqual([{ name: 'Renamed' }]);
    expect(outcome).toMatchObject({ id: 700, title: 'Renamed', changed: ['name'] });

    await expect(updateRun({ runId: 700, fields: {} }, { client: fake.client })).rejects.toThrow(
      'Updating a run needs at least one field to change.',
    );
    expect(fake.calls).toEqual(['update_run/700']);
  });

  it('posts every optional result field that was supplied, and none that were not', async ({ task }) => {
    story.init(task, { tags: ['writes', 'results'], covers: ['src/write/index.ts'] });

    const add = capture([
      { id: 1, test_id: 100, status_id: 1 },
      { id: 2, test_id: 101, status_id: 4 },
    ]);

    const fake = fakeTestRail({ 'add_results_for_cases/612': add.route }, { allowWrites: true });
    cleanup = fake.restore;

    const posted = await reportResults(
      {
        run_id: 612,
        results: [
          { case_id: 10, status: 'passed', elapsed: '30s', version: '1.2.3', assignedto_id: 3 },
          { case_id: 11, status: 'retest' },
        ],
      },
      { client: fake.client, meta: FAKE_META },
    );

    expect(add.sent).toEqual([
      {
        results: [
          { case_id: 10, status_id: 1, elapsed: '30s', version: '1.2.3', assignedto_id: 3 },
          { case_id: 11, status_id: 4 },
        ],
      },
    ]);
    expect(posted).toEqual([
      { resultId: 1, testId: 100, status: 'passed' },
      { resultId: 2, testId: 101, status: 'retest' },
    ]);
  });
});

describe('Writes while writes are disabled', () => {
  it('refuses every write in the client, before any request leaves', async ({ task }) => {
    story.init(task, { tags: ['writes', 'safety'], covers: ['src/write/index.ts', 'src/client.ts'] });

    story.given('a client with writes left at their default: off');
    const fake = fakeTestRail({});
    cleanup = fake.restore;
    const deps = { client: fake.client, meta: FAKE_META };

    story.when('each write is attempted');
    story.then('each is refused as a write, naming the endpoint');
    await expect(createCase({ sectionId: 10, fields: { title: 'x' } }, deps)).rejects.toThrow(
      "Writes are disabled. 'add_case/10' would modify TestRail.",
    );
    await expect(updateCase({ caseId: 5, fields: { title: 'x' } }, deps)).rejects.toThrow(
      "Writes are disabled. 'update_case/5'",
    );
    await expect(createRun({ projectId: 5, fields: { name: 'x' } }, deps)).rejects.toThrow(
      "Writes are disabled. 'add_run/5'",
    );
    await expect(updateRun({ runId: 7, fields: { name: 'x' } }, deps)).rejects.toThrow(
      "Writes are disabled. 'update_run/7'",
    );
    await expect(closeRun({ runId: 7 }, deps)).rejects.toThrow("Writes are disabled. 'close_run/7'");
    await expect(
      reportResults({ run_id: 7, results: [{ case_id: 1, status: 'passed' }] }, deps),
    ).rejects.toThrow("Writes are disabled. 'add_results_for_cases/7'");

    story.and('nothing reached TestRail');
    expect(fake.calls).toEqual([]);
  });
});
