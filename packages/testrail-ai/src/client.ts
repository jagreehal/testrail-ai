import { SpanKind, SpanStatusCode, trace, type Span } from '@opentelemetry/api';
import { z } from 'zod';
import type { Config } from './config';
import type { Json, TestRailBody } from './types';

/**
 * A TestRail API v2 client over native `fetch`. No axios, no SDK.
 *
 * Three things this handles that a bare fetch does not, and that every tool in
 * this server depends on:
 *
 *   1. **The write gate.** Every request funnels through `request()`, so ONE
 *      check on the endpoint verb covers all callers. Adding a tool cannot
 *      accidentally open a write path.
 *   2. **Pagination.** Modern TestRail returns `{ offset, limit, size, _links }`
 *      envelopes; older instances return bare arrays. `list()` normalises both
 *      and follows `_links.next` up to a row cap.
 *   3. **Rate limiting.** TestRail answers 429 with `Retry-After`. Honouring it
 *      is the difference between a slow tool and a failed one.
 */

/** TestRail mutates through these verbs, and only these. */
const WRITE_PREFIXES = ['add_', 'update_', 'delete_', 'close_', 'move_', 'copy_', 'push_'];

export function isWriteEndpoint(endpoint: string): boolean {
  // Decode only the command, not its query values. This closes `%5f` and
  // mixed-case bypasses without changing user-supplied filters.
  const command = endpoint
    .split('&', 1)[0]!
    .replace(/^.*\/api\/v2\//i, '')
    .replace(/^\/+/, '');

  let decoded = command;

  try {
    decoded = decodeURIComponent(command);
  } catch {
    // A malformed escape will fail at TestRail; classification still uses the
    // literal value so a normal endpoint is not hidden by a decoding error.
  }

  const canonical = decoded.toLowerCase();

  return WRITE_PREFIXES.some((prefix) => canonical.startsWith(prefix));
}

/** Transient by nature — TestRail Cloud's load balancer emits these under load. */
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);

export class TestRailError extends Error {
  readonly status: number;
  readonly endpoint: string;
  readonly kind: 'http' | 'network' | 'timeout' | 'invalid_response' | 'write_disabled';

  // Written out longhand rather than as parameter properties: Node's built-in
  // type stripping runs this file directly, and it cannot transform those.
  constructor(
    message: string,
    status: number,
    endpoint: string,
    options: {
      kind?: TestRailError['kind'];
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'TestRailError';
    this.status = status;
    this.endpoint = endpoint;
    this.kind = options.kind ?? 'http';
  }
}

/** The paginated envelope modern TestRail wraps collections in. */
const ErrorBodySchema = z.object({ error: z.string() });

/** A paged response: rows under a collection key, and a link to the next page. */
const EnvelopeSchema = z.looseObject({
  _links: z.object({ next: z.string().nullable().optional() }).optional(),
});

const RowsSchema = z.array(z.json());

/** Parse a response body. `JSON.parse` only ever produces JSON values. */
function parseJson(text: string): Json {
  // SAFETY: JSON.parse returns string, number, boolean, null, arrays and plain objects of those, which is `Json`.
  return JSON.parse(text) as Json;
}

export type ListResult<T> = {
  rows: T[];
  /** True when a row cap stopped us before TestRail ran out of pages. */
  truncated: boolean;
};

/** Runtime capabilities used by the client. Overridable by the testing adapter. */
export type TestRailClientRuntime = {
  fetch: typeof globalThis.fetch;
  timeoutSignal: (milliseconds: number) => AbortSignal;
  sleep: (milliseconds: number) => Promise<void>;
  now: () => number;
};

const DEFAULT_RUNTIME: TestRailClientRuntime = {
  // Looked up per call, so a fetch installed after import (a proxy agent, a test stub) is the one used.
  fetch: (input, init) => globalThis.fetch(input, init),
  timeoutSignal: (milliseconds) => AbortSignal.timeout(milliseconds),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now: Date.now,
};

const tracer = trace.getTracer('testrail-ai');

const MAX_RETRIES = 3;

const MAX_RETRY_DELAY_MS = 30_000;

export class TestRailClient {
  readonly #config: Config;
  readonly #auth: string;
  readonly #runtime: TestRailClientRuntime;

  constructor(config: Config, runtime: Partial<TestRailClientRuntime> = {}) {
    // A snapshot: mutating the caller's object later must not change where this
    // client sends its credential, or what `sharedClient` keyed it under.
    this.#config = Object.freeze({ ...config });
    this.#runtime = { ...DEFAULT_RUNTIME, ...runtime };
    this.#auth = `Basic ${encodeBase64(`${config.email}:${config.apiKey}`)}`;
  }

  get allowWrites(): boolean {
    return this.#config.allowWrites;
  }

  get maxRows(): number {
    return this.#config.maxRows;
  }

  get instanceUrl(): string {
    return this.#config.url;
  }

  /** The configured default project (`TESTRAIL_PROJECT_ID`), if any. */
  get defaultProjectId(): number | undefined {
    return this.#config.defaultProjectId;
  }

  /** `projectId`, or the default project when it is left out. Throws when there is neither. */
  requireProject(projectId: number | undefined): number {
    const resolved = projectId ?? this.#config.defaultProjectId;

    if (resolved === undefined) {
      throw new Error('This needs a project id, and no default project is set (TESTRAIL_PROJECT_ID).');
    }

    return resolved;
  }

  /** A browser link for a TestRail entity, so answers can cite something clickable. */
  link(kind: 'case' | 'run' | 'test' | 'plan' | 'project', id: number): string {
    const path = {
      case: 'cases/view',
      run: 'runs/view',
      test: 'tests/view',
      plan: 'plans/view',
      project: 'projects/overview',
    }[kind];

    return `${this.#config.url}/index.php?/${path}/${id}`;
  }

  /**
   * One request. `endpoint` is a v2 path with its query already appended in
   * TestRail's peculiar style, e.g. `get_cases/5&suite_id=20&limit=250`.
   */
  async request<T>(endpoint: string, body?: TestRailBody): Promise<T> {
    assertEndpoint(endpoint);

    // One client span per request, named by operation (`testrail get_tests`) so
    // names stay few and groupable; ids go in attributes. A no-op unless the
    // process has registered an OpenTelemetry SDK.
    return tracer.startActiveSpan(
      `testrail ${endpoint.split(/[/&]/)[0]}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          'http.request.method': body === undefined ? 'GET' : 'POST',
          'server.address': new URL(this.#config.url).host,
          'testrail.endpoint': endpoint,
        },
      },
      async (span) => {
        try {
          return await this.#send<T>(endpoint, body, span);
        } catch (error) {
          if (error instanceof TestRailError) {
            // An HTTP failure is typed by its status code, anything else by its kind.
            span.setAttribute('error.type', error.kind === 'http' ? String(error.status) : error.kind);

            if (error.status > 0) span.setAttribute('http.response.status_code', error.status);
          }

          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          });

          throw error;
        } finally {
          span.end();
        }
      },
    );
  }

  async #send<T>(endpoint: string, body: TestRailBody | undefined, span: Span): Promise<T> {
    if (isWriteEndpoint(endpoint) && !this.#config.allowWrites) {
      throw new TestRailError(
        `Writes are disabled. '${endpoint}' would modify TestRail. ` +
          'Set TESTRAIL_ALLOW_WRITES=true in the server environment to enable write tools.',
        403,
        endpoint,
        { kind: 'write_disabled' },
      );
    }

    // TestRail's API lives behind a query string, not a path: the whole
    // `/api/v2/...` part is the VALUE of index.php's first parameter.
    const url = `${this.#config.url}/index.php?/api/v2/${endpoint}`;

    for (let attempt = 0; ; attempt++) {
      let response: Response;

      try {
        response = await this.#runtime.fetch(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: this.#auth,
            'Content-Type': 'application/json',
            'User-Agent': 'testrail-ai/0.1',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: this.#runtime.timeoutSignal(this.#config.timeoutMs),
        });
      } catch (cause) {
        const kind = isTimeout(cause) ? 'timeout' : 'network';

        if (body === undefined && attempt < MAX_RETRIES) {
          span.addEvent('retry', { attempt: attempt + 1, reason: kind });
          await this.#runtime.sleep(backoff(attempt));
          continue;
        }

        const detail = cause instanceof Error ? cause.message : String(cause);
        throw new TestRailError(
          `TestRail ${kind === 'timeout' ? 'timed out' : 'network request failed'} on ${endpoint}: ${detail}`,
          0,
          endpoint,
          { kind, cause },
        );
      }

      // 429 means the request was rejected outright, so it is always safe to
      // repeat. A 5xx is only safe on a GET: TestRail may have applied a POST
      // before the gateway gave up, and replaying it would double-post results.
      const retryable =
        response.status === 429 || (body === undefined && RETRY_STATUSES.has(response.status));

      if (retryable && attempt < MAX_RETRIES) {
        const waitMs = retryDelay(response.headers.get('Retry-After'), attempt, this.#runtime.now());
        span.addEvent('retry', {
          attempt: attempt + 1,
          'http.response.status_code': response.status,
          'retry.delay_ms': waitMs,
        });
        // Release the connection before waiting so retries do not exhaust the pool.
        await response.body?.cancel().catch(() => undefined);
        await this.#runtime.sleep(waitMs);
        continue;
      }

      if (!response.ok) {
        // TestRail puts the useful part in `{"error": "..."}`; fall back to the body.
        const text = await response.text();
        let detail = text.slice(0, 500);

        try {
          const parsed = ErrorBodySchema.safeParse(parseJson(text));

          if (parsed.success && parsed.data.error) detail = parsed.data.error;
        } catch {
          // Not JSON — an HTML error page or a proxy. The raw text is the best we have.
        }

        throw new TestRailError(
          `TestRail ${response.status} on ${endpoint}: ${detail}`,
          response.status,
          endpoint,
        );
      }

      span.setAttribute('http.response.status_code', response.status);

      // Some write endpoints (close_run on older builds) answer 200 with no body.
      const text = await response.text();

      let json: Json;

      try {
        json = text ? parseJson(text) : {};
      } catch (cause) {
        throw new TestRailError(
          `TestRail returned invalid JSON on ${endpoint}: ${text.slice(0, 200)}`,
          response.status,
          endpoint,
          { kind: 'invalid_response', cause },
        );
      }

      // SAFETY: T is the caller's statement of this endpoint's documented response. TestRail's payloads are trusted here, not validated.
      return json as T;
    }
  }

  /**
   * A collection, with pagination followed for you.
   *
   * `collection` is the key TestRail nests rows under (`cases`, `runs`, `tests`).
   * Bare-array responses from older instances are returned as-is.
   */
  async list<T>(endpoint: string, collection: string, limit = this.#config.maxRows): Promise<ListResult<T>> {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new RangeError(`Row limit must be a positive integer; received ${String(limit)}.`);
    }

    const rows: T[] = [];
    // TestRail caps `limit` at 250 per page regardless of what you ask for.
    const pageSize = Math.min(250, limit);
    let next: string | undefined = appendQuery(endpoint, `limit=${pageSize}`);

    while (next) {
      const page = await this.request<Json>(next);

      // Older TestRail (and a few endpoints even on new builds) return a bare array.
      const bare = RowsSchema.safeParse(page);

      if (bare.success) {
        const available = Math.max(0, limit - rows.length);
        rows.push(...rowsOf<T>(bare.data.slice(0, available)));

        return { rows, truncated: bare.data.length > available };
      }

      const envelope = EnvelopeSchema.safeParse(page);
      const batch = RowsSchema.safeParse(envelope.success ? envelope.data[collection] : undefined);

      if (!envelope.success || !batch.success) {
        const keys = envelope.success ? Object.keys(envelope.data).join(', ') : '';

        throw new TestRailError(
          `Expected a '${collection}' array from ${endpoint}, got ${keys || 'nothing'}`,
          500,
          endpoint,
          { kind: 'invalid_response' },
        );
      }

      rows.push(...rowsOf<T>(batch.data));

      // `_links.next` arrives as `/api/v2/get_runs/5&limit=250&offset=250`.
      // Strip the prefix; `request()` puts it back.
      const link = envelope.data._links?.next ?? undefined;

      if (rows.length >= limit) {
        return { rows: rows.slice(0, limit), truncated: link !== undefined };
      }

      next = link?.replace(/^\/api\/v2\//, '');
    }

    return { rows, truncated: false };
  }
}

/** Rows of a collection, as the type the caller named for it. */
function rowsOf<T>(rows: Json[]): T[] {
  // SAFETY: T is the caller's statement of TestRail's documented row shape for this collection. Rows are trusted here, not validated.
  return rows as T[];
}

/** Web-standard UTF-8 base64, so the core package also runs outside Node. */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';

  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary);
}

/** TestRail joins query params with `&` even for the first one, because the path IS a param. */
const SHARED_CLIENT_LIMIT = 32;

const sharedClients = new Map<string, TestRailClient>();

/**
 * One client per distinct configuration, for the life of the process.
 *
 * Reference data (statuses, priorities, case types, users) is cached per client,
 * so a server that builds a fresh client per request re-fetches it on every
 * call. The key is the whole config: the same credential with writes on and off
 * gets two clients, and two credentials never share one, because the user list
 * is permission-sensitive. The least recently used client is dropped past 32, so
 * a deployment with a credential per person stays bounded.
 */
export function sharedClient(config: Config): TestRailClient {
  const key = JSON.stringify(Object.entries(config).toSorted(([a], [b]) => (a < b ? -1 : 1)));
  const existing = sharedClients.get(key);

  if (existing) {
    sharedClients.delete(key);
    sharedClients.set(key, existing);

    return existing;
  }

  const client = new TestRailClient(config);
  sharedClients.set(key, client);

  if (sharedClients.size > SHARED_CLIENT_LIMIT) {
    const oldest = sharedClients.keys().next().value;

    if (oldest !== undefined) sharedClients.delete(oldest);
  }

  return client;
}

export function appendQuery(endpoint: string, query: string): string {
  return query ? `${endpoint}&${query}` : endpoint;
}

function assertEndpoint(endpoint: string): void {
  if (
    !endpoint.trim() ||
    // oxlint-disable-next-line no-control-regex -- matching control characters is the point
    /[\u0000-\u001f\u007f]/.test(endpoint)
  ) {
    throw new TypeError('TestRail endpoint must be a non-empty path without control characters.');
  }

  if (/^[/?#]/.test(endpoint) || /^[a-z][a-z\d+.-]*:\/\//i.test(endpoint)) {
    throw new TypeError(`TestRail endpoint must be relative to /api/v2; received '${endpoint}'.`);
  }
}

function isTimeout(cause: unknown): boolean {
  return cause instanceof Error && (cause.name === 'TimeoutError' || cause.name === 'AbortError');
}

function backoff(attempt: number): number {
  return Math.min(2 ** attempt * 1000, MAX_RETRY_DELAY_MS);
}

/** Retry-After is either delta-seconds or an HTTP date (RFC 9110). */
function retryDelay(value: string | null, attempt: number, now: number): number {
  if (value) {
    const seconds = Number(value);

    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, MAX_RETRY_DELAY_MS);
    }

    const date = Date.parse(value);

    if (Number.isFinite(date)) {
      return Math.min(Math.max(0, date - now), MAX_RETRY_DELAY_MS);
    }
  }

  return backoff(attempt);
}
