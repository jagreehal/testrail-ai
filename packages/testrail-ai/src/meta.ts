import { TestRailError, type TestRailClient } from './client';
import { mapWithConcurrency } from './concurrency';
import { isNotPassing, statusKind, type StatusKind } from './status';
import type { CaseType, Priority, Status, User } from './types';

/**
 * Reference data — statuses, priorities, case types, users — changes about once
 * a year and is needed to render almost every answer. Fetching it repeatedly for
 * one client would triple the request count for no benefit, so it is memoised per
 * client. Credentialed clients must never share this cache: `users` is both
 * permission-sensitive and personally identifying.
 */

const TTL_MS = 10 * 60 * 1000;

type Entry<T> = { value: Promise<T>; at: number };

type Loaded = { statuses: Status[]; priorities: Priority[]; case_types: CaseType[]; users: User[] };

type Stores = { [K in keyof Loaded]: WeakMap<TestRailClient, Entry<Loaded[K]>> };

const stores: Stores = {
  statuses: new WeakMap(),
  priorities: new WeakMap(),
  case_types: new WeakMap(),
  users: new WeakMap(),
};

/**
 * Users named one at a time, for keys that cannot list them all. `null` marks
 * an id TestRail would not name, so it is not asked for again.
 */
const namedUsers = new WeakMap<TestRailClient, Map<number, User | null>>();

/** Most users one report looks up individually, so a large run cannot fan out. */
const NAME_LOOKUPS = 20;

// Process-local, with a ten-minute TTL. A status an admin adds mid-session
// appears once the entry expires or the server restarts.
async function cached<K extends keyof Loaded>(
  client: TestRailClient,
  key: K,
  load: () => Promise<Loaded[K]>,
): Promise<Loaded[K]> {
  const store: Stores[K] = stores[key];
  const hit = store.get(client);

  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // Cache the in-flight request too, so concurrent tool/resource reads coalesce.
  const value = load();
  store.set(client, { value, at: Date.now() });

  try {
    return await value;
  } catch (error) {
    store.delete(client);
    throw error;
  }
}

export type Meta = {
  statuses: Map<number, Status>;
  priorities: Map<number, Priority>;
  caseTypes: Map<number, CaseType>;
  users: Map<number, User>;
  statusName: (id: number | null | undefined) => string;
  userName: (id: number | null | undefined) => string;
  priorityName: (id: number | null | undefined) => string;
  typeName: (id: number | null | undefined) => string;
  /** What a status id means for analysis. See `status.ts`. */
  statusKind: (id: number | null | undefined) => StatusKind;
  /** Status ids that mean "this test did not pass" — used by the failure tools. */
  failingStatusIds: number[];
  /**
   * Look up the names of these users when they are not already known, so
   * `userName` can show them. Listing every user needs an administrator key;
   * reading one user does not, so a report calls this with the ids it is about
   * to show. Failures leave the id as `user:N`.
   */
  nameUsers: (ids: (number | null | undefined)[]) => Promise<void>;
};

export async function loadMeta(client: TestRailClient): Promise<Meta> {
  const [statuses, priorities, caseTypes, users] = await Promise.all([
    cached(client, 'statuses', () => client.request<Status[]>('get_statuses')),
    cached(client, 'priorities', () => client.request<Priority[]>('get_priorities')),
    cached(client, 'case_types', () => client.request<CaseType[]>('get_case_types')),
    // A non-admin API key cannot list users. That is not fatal — we just show ids.
    cached(client, 'users', async (): Promise<User[]> => {
      try {
        const result = await client.list<User>('get_users', 'users');

        return result.rows;
      } catch (error) {
        if (error instanceof TestRailError && (error.status === 403 || error.status === 404)) {
          return [];
        }

        throw error;
      }
    }),
  ]);

  const byId = <T extends { id: number }>(rows: T[]) => new Map(rows.map((row) => [row.id, row]));
  const statusMap = byId(statuses);
  const priorityMap = byId(priorities);
  const caseTypeMap = byId(caseTypes);
  const userMap = byId(users);

  const named = namedUsers.get(client) ?? new Map<number, User | null>();
  namedUsers.set(client, named);

  return {
    statuses: statusMap,
    priorities: priorityMap,
    caseTypes: caseTypeMap,
    users: userMap,
    statusName: (id) => (id == null ? 'untested' : (statusMap.get(id)?.name ?? `status:${id}`)),
    userName: (id) =>
      id == null ? 'unassigned' : (userMap.get(id)?.name ?? named.get(id)?.name ?? `user:${id}`),
    priorityName: (id) => (id == null ? '' : (priorityMap.get(id)?.short_name ?? `p:${id}`)),
    typeName: (id) => (id == null ? '' : (caseTypeMap.get(id)?.name ?? `type:${id}`)),
    statusKind: (id) => statusKind(id, statusMap),
    failingStatusIds: statuses.filter((s) => isNotPassing(statusKind(s.id, statusMap))).map((s) => s.id),
    nameUsers: async (ids) => {
      const unknown = [...new Set(ids)]
        .filter((id): id is number => id != null && !userMap.has(id) && !named.has(id))
        .slice(0, NAME_LOOKUPS);

      await mapWithConcurrency(unknown, async (id) => {
        named.set(id, await client.request<User>(`get_user/${id}`).catch(() => null));
      });
    },
  };
}
