import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedClient } from './client';
import type { Config } from './config';
import { loadMeta } from './meta';

const BASE: Config = {
  url: 'https://shared.testrail.io',
  email: 'alice@example.com',
  apiKey: 'key-alice',
  allowWrites: false,
  maxRows: 250,
  timeoutMs: 30_000,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A TestRail that answers per credential, and counts what each asked for. */
function stubTestRail(usersByEmail: Record<string, string[]>) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const endpoint = url.split('/api/v2/')[1] ?? '';
    const auth = new Headers(init?.headers).get('authorization') ?? '';
    const email = atob(auth.replace('Basic ', '')).split(':')[0] ?? '';
    calls.push(`${email} ${endpoint}`);

    const body = endpoint.startsWith('get_users')
      ? {
          offset: 0,
          limit: 250,
          size: 1,
          _links: { next: null },
          users: (usersByEmail[email] ?? []).map((name, id) => ({ id: id + 1, name, email: name })),
        }
      : [];

    return Promise.resolve(Response.json(body));
  });

  return calls;
}

describe('sharedClient', () => {
  it('returns one client for equal configs, however they were built', () => {
    const fresh = { ...BASE, url: 'https://equal.testrail.io' };

    const reordered: Config = {
      timeoutMs: fresh.timeoutMs,
      maxRows: fresh.maxRows,
      allowWrites: fresh.allowWrites,
      apiKey: fresh.apiKey,
      email: fresh.email,
      url: fresh.url,
    };

    expect(sharedClient(reordered)).toBe(sharedClient({ ...fresh }));
  });

  it('keeps a write-enabled config apart from a read-only one on the same credential', () => {
    const readOnly = sharedClient({ ...BASE, url: 'https://writes.testrail.io' });
    const writer = sharedClient({ ...BASE, url: 'https://writes.testrail.io', allowWrites: true });
    expect(readOnly).not.toBe(writer);
    expect(readOnly.allowWrites).toBe(false);
    expect(writer.allowWrites).toBe(true);
  });

  it('never shares a client between credentials', () => {
    const alice = sharedClient({ ...BASE, url: 'https://creds.testrail.io' });

    const bob = sharedClient({
      ...BASE,
      url: 'https://creds.testrail.io',
      email: 'bob@example.com',
      apiKey: 'key-bob',
    });

    expect(alice).not.toBe(bob);
  });

  it('never shares a client between TestRail instances, even on the same credential', () => {
    const one = sharedClient({ ...BASE, url: 'https://one.testrail.io' });
    const two = sharedClient({ ...BASE, url: 'https://two.testrail.io' });

    expect(one).not.toBe(two);
    expect(two.instanceUrl).toBe('https://two.testrail.io');
  });

  it('drops the least recently used client past 32', () => {
    const first = sharedClient({ ...BASE, url: 'https://lru-0.testrail.io' });

    for (let index = 1; index <= 32; index++)
      sharedClient({ ...BASE, url: `https://lru-${index}.testrail.io` });
    expect(sharedClient({ ...BASE, url: 'https://lru-0.testrail.io' })).not.toBe(first);
  });

  it('loads reference data once per credential, and keeps each credential to its own users', async () => {
    const calls = stubTestRail({ 'alice@example.com': ['Alice'], 'bob@example.com': ['Bob', 'Carol'] });
    const aliceConfig = { ...BASE, url: 'https://meta.testrail.io' };
    const bobConfig = { ...aliceConfig, email: 'bob@example.com', apiKey: 'key-bob' };

    // Two requests each, as a per-request server factory would make them.
    const aliceFirst = await loadMeta(sharedClient({ ...aliceConfig }));
    await loadMeta(sharedClient({ ...aliceConfig }));
    const bobMeta = await loadMeta(sharedClient({ ...bobConfig }));
    await loadMeta(sharedClient({ ...bobConfig }));

    expect(calls.filter((call) => call === 'alice@example.com get_statuses')).toHaveLength(1);
    expect(calls.filter((call) => call === 'bob@example.com get_statuses')).toHaveLength(1);
    expect([...aliceFirst.users.values()].map((user) => user.name)).toEqual(['Alice']);
    expect([...bobMeta.users.values()].map((user) => user.name)).toEqual(['Bob', 'Carol']);
  });

  it('ignores later changes to the config object it was given', () => {
    const config: Config = { ...BASE, url: 'https://snapshot.testrail.io' };
    const client = sharedClient(config);

    config.allowWrites = true;
    config.url = 'https://elsewhere.example';

    const again = sharedClient({ ...BASE, url: 'https://snapshot.testrail.io' });

    expect(again).toBe(client);
    expect(again.allowWrites).toBe(false);
    expect(again.instanceUrl).toBe('https://snapshot.testrail.io');
  });
});
