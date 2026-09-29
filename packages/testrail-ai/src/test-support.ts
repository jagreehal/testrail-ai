import { z } from 'zod';
import { TestRailClient } from './client';
import type { Config } from './config';
import type { Meta } from './meta';
import type { Json } from './types';
import { statusKind } from './status';

/**
 * A fake TestRail, stubbed at `fetch` rather than at our own client.
 *
 * Stubbing the client would leave its two hardest parts — the pagination
 * envelope and the write gate — untested. Stubbing `fetch` means every test
 * exercises the real URL construction, the real `_links.next` following and the
 * real 429 handling, against responses shaped exactly like TestRail's.
 *
 * Not exported from the package index: this is for our own tests.
 */

/** What a fake endpoint answers: a JSON body, or a whole `Response` for status codes and headers. */
export type Reply = Json | Response;

type Handler = (url: string, init: RequestInit | undefined) => Reply;

/** A fixed reply, or one computed from the request. */
export type Route = Reply | Handler;

function isHandler(route: Route): route is Handler {
  return typeof route === 'function';
}

export type FakeTestRail = {
  client: TestRailClient;
  /** Every endpoint requested, in order — lets a test assert on call count. */
  calls: string[];
  /** Retained for compatibility; fakes no longer mutate process-global state. */
  restore: () => void;
};

export const TEST_CONFIG: Config = {
  url: 'https://example.testrail.io',
  email: 'qa@example.com',
  apiKey: 'key',
  allowWrites: false,
  maxRows: 250,
  timeoutMs: 5000,
};

/**
 * `routes` maps an endpoint prefix (the part after `/api/v2/`) to a responder.
 * The longest matching prefix wins, so `get_runs/5&suite_id=2` can be handled
 * separately from `get_runs/5`.
 */
export function fakeTestRail(routes: Record<string, Route>, overrides: Partial<Config> = {}): FakeTestRail {
  const calls: string[] = [];

  const fakeFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const endpoint = decodeURIComponent(url.split('/api/v2/')[1] ?? '');
    calls.push(endpoint);

    const match = Object.entries(routes)
      .filter(([prefix]) => endpoint.startsWith(prefix))
      .toSorted(([a], [b]) => b.length - a.length)[0];

    if (match === undefined) {
      return new Response(JSON.stringify({ error: `No fake route for '${endpoint}'` }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const [, handler] = match;
    const body = isHandler(handler) ? handler(url, init) : handler;

    if (body instanceof Response) return body;

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  return {
    client: new TestRailClient(
      { ...TEST_CONFIG, ...overrides },
      {
        fetch: fakeFetch,
        // Retry behaviour matters; wall-clock backoff does not belong in a unit test.
        sleep: async () => undefined,
        now: () => 0,
      },
    ),
    calls,
    restore: () => undefined,
  };
}

/** The JSON body a fake route was sent; `null` when the request had none. */
export function sentBody(init: RequestInit | undefined): Json {
  const text = z.string().safeParse(init?.body);

  // SAFETY: the client sends `JSON.stringify` output, which parses back to `Json`.
  return text.success ? (JSON.parse(text.data) as Json) : null;
}

/** TestRail's paginated envelope, so tests do not hand-write `_links` each time. */
export function page<T extends Json>(collection: string, rows: T[], next: string | null = null) {
  return {
    offset: 0,
    limit: 250,
    size: rows.length,
    _links: { next, prev: null },
    [collection]: rows,
  };
}

/** Reference data matching a stock TestRail instance. */
export const FAKE_META: Meta = {
  statuses: new Map(),
  priorities: new Map(),
  caseTypes: new Map(),
  users: new Map(),
  statusName: (id) =>
    id == null
      ? 'untested'
      : ({ 1: 'passed', 2: 'blocked', 3: 'untested', 4: 'retest', 5: 'failed' }[id] ?? `status:${id}`),
  userName: (id) => (id == null ? 'unassigned' : `user:${id}`),
  nameUsers: async () => undefined,
  priorityName: (id) =>
    id == null ? '' : ({ 1: 'Low', 2: 'Medium', 3: 'High', 4: 'Critical' }[id] ?? `p:${id}`),
  typeName: (id) => (id == null ? '' : `type:${id}`),
  statusKind: (id) => statusKind(id, new Map()),
  // Everything that is neither passed (1) nor untested (3).
  failingStatusIds: [2, 4, 5],
};
