import type { TestRailClient } from './client';
import { loadMeta, type Meta } from './meta';

/**
 * Dependencies, passed explicitly.
 *
 * Every analysis and write function takes `(args, deps)`: what to do, and what
 * to do it with. Two things follow from that, and both are why it is worth the
 * extra brace.
 *
 * A caller can see exactly what a function reaches for by reading its
 * signature — no module-level singleton, no hidden import of a shared client.
 * And a test supplies whatever it likes without `vi.mock`: no module-path
 * coupling that breaks when a folder is renamed, no hoisting rules to fight, no
 * global mock registry leaking between tests.
 */

/** For functions that only talk to TestRail. */
export type ClientDeps = {
  client: TestRailClient;
};

/** For functions that also need the status/priority/type lookup tables. */
export type TestRailDeps = ClientDeps & {
  /** Optional preloaded reference data; otherwise the task acquires it safely. */
  meta?: Meta;
};

/** Keep metadata acquisition inside task modules rather than transport adapters. */
export async function resolveMeta(deps: TestRailDeps): Promise<Meta> {
  return deps.meta ?? loadMeta(deps.client);
}
