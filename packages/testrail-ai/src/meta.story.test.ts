import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';
import { loadMeta } from './meta';
import { fakeTestRail, page } from './test-support';

const referenceData = (name: string, email: string) => ({
  get_statuses: [{ id: 1, name, label: name, is_final: true, is_untested: false }],
  get_priorities: [],
  get_case_types: [],
  get_users: page('users', [{ id: 1, name, email }]),
});

describe('Reference-data ownership', () => {
  it('never shares cached users or statuses between credentialed clients', async ({ task }) => {
    story.init(task, { tags: ['security', 'cache', 'regression'], covers: ['src/meta.ts'] });
    const admin = fakeTestRail(referenceData('admin-status', 'admin@example.com'));
    const viewer = fakeTestRail(referenceData('viewer-status', 'viewer@example.com'));

    const adminMeta = await loadMeta(admin.client);
    const viewerMeta = await loadMeta(viewer.client);

    expect(adminMeta.statusName(1)).toBe('admin-status');
    expect(viewerMeta.statusName(1)).toBe('viewer-status');
    expect(adminMeta.users.get(1)?.email).toBe('admin@example.com');
    expect(viewerMeta.users.get(1)?.email).toBe('viewer@example.com');
    expect(admin.calls).toHaveLength(4);
    expect(viewer.calls).toHaveLength(4);
  });

  it('coalesces concurrent loads for the same client', async ({ task }) => {
    story.init(task, { tags: ['cache', 'concurrency'], covers: ['src/meta.ts'] });
    const fake = fakeTestRail(referenceData('passed', 'qa@example.com'));

    await Promise.all([loadMeta(fake.client), loadMeta(fake.client)]);

    expect(fake.calls).toHaveLength(4);
  });

  it('treats a forbidden user directory as optional', async ({ task }) => {
    story.init(task, { tags: ['permissions', 'resilience'] });

    const fake = fakeTestRail({
      ...referenceData('passed', 'qa@example.com'),
      get_users: () => new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 }),
    });

    const meta = await loadMeta(fake.client);

    expect(meta.users.size).toBe(0);
  });

  it('names the people a report shows when the key cannot list everyone', async ({ task }) => {
    story.init(task, { tags: ['permissions', 'users'], covers: ['src/meta.ts'] });

    story.given('a key that cannot list users, but can read one: user 3 exists, user 4 does not');

    const fake = fakeTestRail({
      ...referenceData('passed', 'qa@example.com'),
      get_users: () => new Response('{"error":"admin only"}', { status: 403 }),
      'get_user/3': { id: 3, name: 'Alice', email: 'alice@example.com' },
    });

    const meta = await loadMeta(fake.client);

    story.when('a report names users 3, 4, 3 and nobody');
    await meta.nameUsers([3, 4, 3, null]);

    story.then('Alice is named, the unknown id stays an id, and each is asked for once');
    expect([meta.userName(3), meta.userName(4), meta.userName(null)]).toEqual([
      'Alice',
      'user:4',
      'unassigned',
    ]);
    expect(fake.calls.filter((call) => call.startsWith('get_user/')).toSorted()).toEqual([
      'get_user/3',
      'get_user/4',
    ]);

    story.and('a later report reuses what was learned, without asking again');
    const later = await loadMeta(fake.client);
    await later.nameUsers([3, 4]);
    expect(later.userName(3)).toBe('Alice');
    expect(fake.calls.filter((call) => call.startsWith('get_user/'))).toHaveLength(2);
  });

  it('looks up at most twenty people for one report', async () => {
    const fake = fakeTestRail({
      ...referenceData('passed', 'qa@example.com'),
      get_users: () => new Response('{}', { status: 403 }),
      'get_user/': (url) => ({ id: Number(url.split('get_user/')[1]), name: 'Someone', email: '' }),
    });

    const meta = await loadMeta(fake.client);
    await meta.nameUsers(Array.from({ length: 50 }, (_, index) => index + 100));

    expect(fake.calls.filter((call) => call.startsWith('get_user/'))).toHaveLength(20);
  });

  it('does not hide an upstream user-directory outage', async ({ task }) => {
    story.init(task, { tags: ['errors', 'resilience', 'regression'] });
    let attempts = 0;

    const fake = fakeTestRail({
      ...referenceData('passed', 'qa@example.com'),
      get_users: () => {
        attempts++;

        return new Response(JSON.stringify({ error: 'unavailable' }), { status: 500 });
      },
    });

    await expect(loadMeta(fake.client)).rejects.toThrow(/unavailable/);
    await expect(loadMeta(fake.client)).rejects.toThrow(/unavailable/);
    expect(attempts).toBe(8);
  });
});
