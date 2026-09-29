/**
 * Bounded parallelism for the read paths.
 *
 * Several analyses need one request per run — stability compares up to 25 runs,
 * coverage walks the recent ones. Those fetches are independent of each other,
 * and awaiting them in a loop made a 25-run comparison 25 sequential round trips.
 *
 * Measured against a real instance, same workload, concurrency 1 vs 6:
 *
 *   5 small runs (20-30 tests each)   4.5s → 2.9s
 *   8 runs incl. two ~900-test runs  29.7s → 12.8s
 *
 * The ceiling is pagination, which is inherently sequential: you cannot ask for
 * page 3 until page 2 tells you it exists. A 950-test run is four chained
 * requests and no amount of cross-run parallelism shortens that chain. This
 * parallelises across runs, not within one — which is why the win grows with
 * the number of runs rather than with their size.
 *
 * Unbounded `Promise.all` is the other wrong answer: TestRail Cloud rate-limits,
 * and the 429 backoff costs more than the concurrency saves. Hence a cap.
 */

/**
 * Requests in flight at once. Six is comfortable on TestRail Cloud — no 429s
 * observed across the runs above — and tunable for self-hosted instances behind
 * a stricter proxy, or for a CI job that wants to be a polite neighbour.
 */
export const DEFAULT_CONCURRENCY = 6;

/**
 * Map over `items` with at most `limit` promises in flight, preserving input
 * order in the result.
 *
 * Order matters here: stability reads a timeline, and a result array shuffled by
 * completion time would reorder history.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  worker: (item: T, index: number) => Promise<R>,
  limit = DEFAULT_CONCURRENCY,
): Promise<R[]> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(`Concurrency limit must be a positive integer; received ${String(limit)}.`);
  }

  if (items.length === 0) return [];

  if (items.length === 1) return [await worker(items[0]!, 0)];

  const results: R[] = [];
  let next = 0;

  // Each runner pulls the next index until the queue is drained. Simpler than
  // chunking, and it keeps every slot busy when request latencies differ.
  const runner = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      results[index] = await worker(items[index]!, index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));

  return results;
}
