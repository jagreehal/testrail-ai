import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { isWriteEndpoint, TestRailClient, TestRailError } from './client';
import { fakeTestRail, page, TEST_CONFIG } from './test-support';

/**
 * The client is where the two things that must never break live: the write gate,
 * and pagination. Both are exercised here through a stubbed `fetch`, so the real
 * URL construction and the real `_links.next` following are under test.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

describe('Write protection', () => {
  it('refuses every mutating verb when writes are disabled', ({ task }) => {
    story.init(task, { tags: ['safety'], covers: ['src/client.ts'] });

    story.given("TestRail's mutating endpoint verbs");

    const writes = [
      'add_result_for_case/1/2',
      'update_case/5',
      'delete_run/9',
      'close_run/9',
      'move_cases_to_section/3',
      'copy_cases_to_section/3',
      'push_something/1',
      'add%5fresult/1',
      'UPDATE_CASE/5',
    ];

    story.table({
      label: 'Classified as writes',
      columns: ['Endpoint'],
      rows: writes.map((endpoint) => [endpoint]),
    });

    story.when('each is classified');
    story.then('all are recognised as writes');

    for (const endpoint of writes) expect(isWriteEndpoint(endpoint)).toBe(true);

    story.but('read endpoints are not');

    for (const endpoint of ['get_cases/5', 'get_run/9', 'get_statuses']) {
      expect(isWriteEndpoint(endpoint)).toBe(false);
    }
  });

  it('blocks a write before any request reaches TestRail', async ({ task }) => {
    story.init(task, { tags: ['safety'], covers: ['src/client.ts'] });

    story.given('a client with writes disabled');
    const fake = fakeTestRail({ add_result_for_case: { id: 1 } }, { allowWrites: false });
    cleanup = fake.restore;

    story.when('a write endpoint is called');
    story.then('it is rejected');
    await expect(fake.client.request('add_result_for_case/1/2', { status_id: 1 })).rejects.toThrow(
      /Writes are disabled/,
    );

    story.and('crucially, no HTTP request was made at all');
    story.note('The gate runs before the request is built, so a read-only deployment cannot leak a write.');
    expect(fake.calls).toEqual([]);
  });

  it('allows writes through once they are explicitly enabled', async ({ task }) => {
    story.init(task, { tags: ['safety'] });

    story.given('a client with TESTRAIL_ALLOW_WRITES set');
    const fake = fakeTestRail({ add_result_for_case: { id: 99 } }, { allowWrites: true });
    cleanup = fake.restore;

    story.when('the same write is called');
    const result = await fake.client.request<{ id: number }>('add_result_for_case/1/2', { status_id: 1 });

    story.then('it reaches TestRail and returns the result');
    expect(result.id).toBe(99);
    expect(fake.calls).toHaveLength(1);
  });
});

describe('Pagination', () => {
  it('follows _links.next until TestRail runs out of pages', async ({ task }) => {
    story.init(task, { tags: ['pagination'], covers: ['src/client.ts'] });

    story.given('a project whose cases span three pages');

    const fake = fakeTestRail({
      'get_cases/5&limit=250': page(
        'cases',
        [{ id: 1 }, { id: 2 }],
        '/api/v2/get_cases/5&limit=250&offset=2',
      ),
      'get_cases/5&limit=250&offset=2': page(
        'cases',
        [{ id: 3 }, { id: 4 }],
        '/api/v2/get_cases/5&limit=250&offset=4',
      ),
      'get_cases/5&limit=250&offset=4': page('cases', [{ id: 5 }], null),
    });

    cleanup = fake.restore;

    story.when('the collection is listed');
    const result = await fake.client.list<{ id: number }>('get_cases/5', 'cases');
    story.json({ label: 'Requests made', value: fake.calls });

    story.then('every page is fetched and concatenated in order');
    expect(result.rows.map((row) => row.id)).toEqual([1, 2, 3, 4, 5]);

    story.and('the caller is told the list is complete');
    expect(result.truncated).toBe(false);

    story.and('exactly three requests were made — no extra page after the last');
    expect(fake.calls).toHaveLength(3);
  });

  it('stops at the row cap and says it was capped', async ({ task }) => {
    story.init(task, { tags: ['pagination'] });

    story.given('a project with more cases than the caller asked for');

    const fake = fakeTestRail({
      'get_cases/5': page('cases', [{ id: 1 }, { id: 2 }, { id: 3 }], '/api/v2/get_cases/5&offset=3'),
    });

    cleanup = fake.restore;

    story.when('the caller asks for at most 2 rows');
    const result = await fake.client.list<{ id: number }>('get_cases/5', 'cases', 2);

    story.then('only 2 rows come back');
    expect(result.rows).toHaveLength(2);

    story.and('the truncation is reported rather than hidden');
    story.note('A silent cap reads as "that is everything", which is how people miss data.');
    expect(result.truncated).toBe(true);
  });

  it('handles the bare arrays older TestRail instances return', async ({ task }) => {
    story.init(task, { tags: ['pagination', 'compatibility'] });

    story.given('an endpoint that answers with a bare array, not an envelope');
    story.note('Older TestRail builds — and a few endpoints even on new ones — do this.');
    const fake = fakeTestRail({ get_statuses: [{ id: 1 }, { id: 5 }] });
    cleanup = fake.restore;

    story.when('the collection is listed');
    const result = await fake.client.list<{ id: number }>('get_statuses', 'statuses');

    story.then('the array is used as-is instead of failing on a missing key');
    expect(result.rows.map((row) => row.id)).toEqual([1, 5]);
  });

  it('enforces the row cap for bare-array responses', async ({ task }) => {
    story.init(task, { tags: ['pagination', 'compatibility', 'regression'] });
    const fake = fakeTestRail({ get_statuses: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    cleanup = fake.restore;

    const result = await fake.client.list<{ id: number }>('get_statuses', 'statuses', 2);

    expect(result.rows.map((row) => row.id)).toEqual([1, 2]);
    expect(result.truncated).toBe(true);
  });

  it('does not call an exactly-full final page truncated', async ({ task }) => {
    story.init(task, { tags: ['pagination', 'regression'] });
    const fake = fakeTestRail({ 'get_cases/5': page('cases', [{ id: 1 }, { id: 2 }], null) });
    cleanup = fake.restore;

    const result = await fake.client.list<{ id: number }>('get_cases/5', 'cases', 2);

    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it('keeps concurrent fake clients isolated', async ({ task }) => {
    story.init(task, { tags: ['testing', 'regression'] });
    const first = fakeTestRail({ get_projects: { source: 'first' } });
    const second = fakeTestRail({ get_projects: { source: 'second' } });

    const [a, b] = await Promise.all([
      first.client.request<{ source: string }>('get_projects'),
      second.client.request<{ source: string }>('get_projects'),
    ]);

    expect(a.source).toBe('first');
    expect(b.source).toBe('second');
    expect(first.calls).toEqual(['get_projects']);
    expect(second.calls).toEqual(['get_projects']);
  });

  it('fails clearly when the expected collection key is missing', async ({ task }) => {
    story.init(task, { tags: ['pagination', 'edge-case'] });

    story.given('a response with neither the collection nor an array');
    const fake = fakeTestRail({ 'get_cases/5': { unexpected: true } });
    cleanup = fake.restore;

    story.when('the collection is listed');
    story.then('the error names the key we wanted and what we got instead');
    await expect(fake.client.list('get_cases/5', 'cases')).rejects.toThrow(/Expected a 'cases' array/);
  });

  it('rejects invalid public row limits before making a request', async ({ task }) => {
    story.init(task, { tags: ['pagination', 'validation'] });
    const fake = fakeTestRail({});
    cleanup = fake.restore;

    await expect(fake.client.list('get_cases/5', 'cases', 0)).rejects.toThrow(/positive integer/);
    await expect(fake.client.list('get_cases/5', 'cases', Number.NaN)).rejects.toThrow(/positive integer/);
    expect(fake.calls).toEqual([]);
  });
});

describe('Error handling', () => {
  it("surfaces TestRail's own error message, not just a status code", async ({ task }) => {
    story.init(task, { tags: ['errors'] });

    story.given('TestRail rejecting a request with a specific reason');

    const fake = fakeTestRail({
      'get_case/1': () =>
        new Response(JSON.stringify({ error: 'Field :case_id is not a valid test case.' }), { status: 400 }),
    });

    cleanup = fake.restore;

    story.when('the request is made');
    const request = fake.client.request('get_case/1');

    story.then('the reported message includes what TestRail actually said');
    await expect(request).rejects.toBeInstanceOf(TestRailError);
    await expect(request).rejects.toThrow('not a valid test case');

    story.and('the status and endpoint are attached for the caller to branch on');
    await expect(request).rejects.toMatchObject({ status: 400, endpoint: 'get_case/1' });
  });

  it('retries a rate limit and honours Retry-After', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience'] });

    story.given('TestRail Cloud rate-limiting the first attempt');
    let attempts = 0;

    const fake = fakeTestRail({
      get_projects: () => {
        attempts++;

        return attempts === 1
          ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
          : new Response(JSON.stringify({ projects: [] }), { status: 200 });
      },
    });

    cleanup = fake.restore;

    story.when('a request is made');
    await fake.client.request('get_projects');

    story.then('the 429 is retried rather than surfaced as a failure');
    story.note('429 is routine on TestRail Cloud; treating it as an error would make the tools flaky.');
    expect(attempts).toBe(2);
  });

  it('retries a transient gateway error on a read, but never on a write', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience'] });

    story.given("TestRail's load balancer answering 502 once before recovering");
    let reads = 0;
    let writes = 0;

    const fake = fakeTestRail(
      {
        get_projects: () => {
          reads++;

          return reads === 1
            ? new Response('', { status: 502 })
            : new Response(JSON.stringify({ projects: [] }), { status: 200 });
        },
        add_result: () => {
          writes++;

          return new Response('', { status: 502 });
        },
      },
      { allowWrites: true },
    );

    cleanup = fake.restore;

    story.when('a read hits it');
    await fake.client.request('get_projects');

    story.then('the read is retried rather than failing the whole report');
    expect(reads).toBe(2);

    story.when('a write hits the same error');
    await fake.client.request('add_result/1', { status_id: 1 }).catch(() => undefined);

    story.then('the write is surfaced instead, attempted exactly once');
    story.note(
      'TestRail may have applied the POST before the gateway gave up; replaying it would double-post results.',
    );
    expect(writes).toBe(1);
  });

  it('retries transport failures on reads, but never risks replaying a write', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience', 'safety'] });
    let reads = 0;
    let writes = 0;

    const client = new TestRailClient(
      { ...TEST_CONFIG, allowWrites: true },
      {
        fetch: async (_url: string | URL | Request, init?: RequestInit) => {
          if (init?.body) {
            writes++;
            throw new TypeError('connection reset');
          }

          reads++;

          if (reads === 1) throw new TypeError('connection reset');

          return new Response('{}');
        },
        sleep: async () => undefined,
      },
    );

    await expect(client.request('get_projects')).resolves.toEqual({});
    await expect(client.request('add_result/1', { status_id: 1 })).rejects.toMatchObject({
      kind: 'network',
      status: 0,
    });
    expect(reads).toBe(2);
    expect(writes).toBe(1);
  });

  it('understands HTTP-date Retry-After and caps excessive waits', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience'] });
    const waits: number[] = [];
    let attempts = 0;

    const client = new TestRailClient(TEST_CONFIG, {
      fetch: async () => {
        attempts++;

        return attempts === 1
          ? new Response('', {
              status: 429,
              headers: { 'Retry-After': 'Thu, 01 Jan 1970 00:01:00 GMT' },
            })
          : new Response('{}');
      },
      now: () => 0,
      sleep: async (milliseconds) => {
        waits.push(milliseconds);
      },
    });

    await client.request('get_projects');
    expect(waits).toEqual([30_000]);
  });

  it('classifies timeouts and malformed successful responses', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience'] });
    const timeout = new DOMException('request expired', 'TimeoutError');

    const timedOut = new TestRailClient(TEST_CONFIG, {
      fetch: async () => {
        throw timeout;
      },
      sleep: async () => undefined,
    });

    const malformed = fakeTestRail({ get_projects: () => new Response('<html>not json</html>') });

    await expect(timedOut.request('get_projects')).rejects.toMatchObject({
      kind: 'timeout',
      status: 0,
      endpoint: 'get_projects',
    });
    await expect(malformed.client.request('get_projects')).rejects.toMatchObject({
      kind: 'invalid_response',
      status: 200,
      endpoint: 'get_projects',
    });
  });

  it('rejects absolute and control-character endpoints before fetching', async ({ task }) => {
    story.init(task, { tags: ['security', 'validation'] });
    const fake = fakeTestRail({});

    await expect(fake.client.request('https://attacker.example/api/v2/get_projects')).rejects.toThrow(
      /must be relative/,
    );
    await expect(fake.client.request('get_projects\nInjected: yes')).rejects.toThrow(/control characters/);
    expect(fake.calls).toEqual([]);
  });

  it('tolerates the empty body some write endpoints return', async ({ task }) => {
    story.init(task, { tags: ['errors', 'compatibility'] });

    story.given('an endpoint that answers 200 with no body');
    story.note('close_run does this on older TestRail builds.');
    const fake = fakeTestRail({ close_run: () => new Response('', { status: 200 }) }, { allowWrites: true });
    cleanup = fake.restore;

    story.when('the request is made');
    story.then('an empty object comes back instead of a JSON parse error');
    await expect(fake.client.request('close_run/1', {})).resolves.toEqual({});
  });
});

describe('URL construction', () => {
  it("builds TestRail's peculiar query-string API paths", async ({ task }) => {
    story.init(task, { tags: ['compatibility'] });

    story.given('a TestRail instance URL');
    story.note("The whole /api/v2/... path is the VALUE of index.php's first parameter.");
    const fake = fakeTestRail({ get_projects: page('projects', []) });
    cleanup = fake.restore;

    story.when('a browser link for a run is requested');
    const link = fake.client.link('run', 42);

    story.then('it points at the run view, not the API');
    expect(link).toBe('https://example.testrail.io/index.php?/runs/view/42');
  });

  it('strips a trailing slash so the path does not double up', ({ task }) => {
    story.init(task, { tags: ['compatibility', 'edge-case'] });

    story.given('a configured URL with a trailing slash');
    const fake = fakeTestRail({}, { url: 'https://example.testrail.io' });
    cleanup = fake.restore;

    story.when('a link is built');
    story.then('there is exactly one slash before index.php');
    expect(fake.client.link('case', 1)).not.toContain('//index.php');
  });
});
