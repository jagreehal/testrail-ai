/**
 * Test helpers, published as `testrail-ai/testing`.
 *
 * A fake TestRail stubbed at `fetch`, so code under test exercises the real
 * client — real URL construction, real pagination, real write gate — against
 * responses shaped exactly like TestRail's. Kept out of the main entry point so
 * it never lands in a production bundle.
 */
export { fakeTestRail, page, FAKE_META, sentBody, TEST_CONFIG } from './test-support';

export type { FakeTestRail, Reply, Route } from './test-support';
