import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import { fakeTestRail, page, TEST_CONFIG } from 'testrail-ai/testing';
import { createPrincipal, gate, type Principal } from 'mcp-authz';
import { afterEach, describe, expect, it } from 'vitest';
import { GATE_PERMISSIONS, type GatePermission } from './permissions';
import { buildServer } from './server';

/**
 * The gated deployment, run for real.
 *
 * `server.story.test.ts` proves this package's half of the contract: the `wrap`
 * hook sees every registration, and `recordCapabilities` confirms
 * `GATE_PERMISSIONS` prices everything the server lists. Neither runs `gate()`.
 *
 * This file does. A real `gate()` over the real map, driven through the real
 * protocol, so the claim "a reader does not see `testrail_run`" is checked
 * rather than asserted in prose — and an upgrade of `mcp-authz` that changes
 * what a gate does to this server fails here instead of in someone's cluster.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const REFERENCE_DATA = {
  get_statuses: [
    { id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false },
    { id: 5, name: 'failed', label: 'Failed', is_final: true, is_untested: false },
  ],
  get_priorities: [{ id: 2, name: 'Medium', short_name: 'Medium' }],
  get_case_types: [{ id: 7, name: 'Other' }],
  get_users: page('users', []),
  get_projects: page('projects', [{ id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false }]),
  'get_case/101': { id: 101, title: 'Login', section_id: 1, suite_id: 20, priority_id: 2, type_id: 7 },
};

function principalWith(
  email: string,
  role: string,
  permissions: GatePermission[],
): Principal<GatePermission> {
  return createPrincipal(
    { issuer: 'https://login.acme.com', sub: `sub-${email}`, email, emailVerified: true, claims: {} },
    [role],
    permissions,
  );
}

const READER = principalWith('dana@acme.com', 'reader', ['testrail:read']);

const EDITOR = principalWith('alice@acme.com', 'editor', ['testrail:read', 'testrail:write']);

const ADMIN = principalWith('sam@acme.com', 'admin', ['testrail:read', 'testrail:write', 'testrail:admin']);

/**
 * Exactly the wiring README.md and SECURITY.md prescribe. Writes are on, so the
 * only thing deciding who may reach a mutating tool is the gate.
 */
async function connectAs(principal: Principal<GatePermission>) {
  const fake = fakeTestRail(REFERENCE_DATA, { allowWrites: true });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const server = buildServer(
    { ...TEST_CONFIG, allowWrites: true },
    { client: fake.client, wrap: (built) => gate(built, principal, GATE_PERMISSIONS) },
  );

  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);

  return {
    client,
    calls: fake.calls,
    close: () => {
      fake.restore();
      void client.close();
      void server.close();
    },
  };
}

const toolNames = async (client: Client) =>
  (await client.listTools()).tools.map((tool) => tool.name).toSorted();

describe('Gating this server per person with mcp-authz', () => {
  it('gives a reader the six read tools and none of the mutating ones', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization'], covers: ['src/permissions.ts', 'src/server.ts'] });

    story.given('a reader, gated with the exported permission map');
    const session = await connectAs(READER);
    cleanup = session.close;

    story.when('the tool list is requested');
    const tools = await toolNames(session.client);
    story.table({
      label: "Dana's catalogue",
      columns: ['Tool', 'Visible'],
      rows: Object.keys(GATE_PERMISSIONS)
        .filter((label) => !label.includes(':'))
        .map((name) => [name, String(tools.includes(name))]),
    });

    story.then('she sees the six priced testrail:read');
    expect(tools).toEqual([
      'testrail_case',
      'testrail_coverage',
      'testrail_failures',
      'testrail_flaky',
      'testrail_run_report',
      'testrail_search',
    ]);

    story.and('the write tools and the admin escape hatch are absent, not merely refused');
    story.note(
      'Absent matters twice: ten schemas cost context on every turn, and a tool the model can see ' +
        'is a tool it will try, burn a turn on, and route around.',
    );

    for (const hidden of ['testrail_run', 'testrail_report_result', 'testrail_raw']) {
      expect(tools).not.toContain(hidden);
    }
  });

  it('refuses the call even when a client names a tool it was never shown', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization', 'safety'] });

    story.given('a reader who skips the list and calls the write tool directly');
    const session = await connectAs(READER);
    cleanup = session.close;

    story.when('she calls testrail_report_result');

    const call = session.client.callTool({
      name: 'testrail_report_result',
      arguments: { test_id: 1, status: 'passed' },
    });

    story.then('the SDK refuses it, so hiding the tool was never the security boundary');
    await expect(call).rejects.toThrow('Tool testrail_report_result disabled');
  });

  it('keeps a reader to reading a case, even with writes on', async ({ task }) => {
    story.init(task, {
      tags: ['mcp', 'authorization', 'safety'],
      covers: ['src/permissions.ts', 'src/tools.ts'],
    });

    story.given('a reader, on a server whose credential may write');
    const session = await connectAs(READER);
    cleanup = session.close;

    story.when('she asks testrail_case to update C101');

    const read = await session.client.callTool({
      name: 'testrail_case',
      arguments: { action: 'update', case_id: 101, title: 'Renamed', include_history: false },
    });

    story.then('she gets the case back, and TestRail receives no update');
    expect(read.isError).not.toBe(true);
    expect(session.calls.some((endpoint) => endpoint.startsWith('update_case'))).toBe(false);

    story.and('the tool that writes cases refuses her');
    await expect(
      session.client.callTool({
        name: 'testrail_case_write',
        arguments: { action: 'update', case_id: 101, title: 'Renamed' },
      }),
    ).rejects.toThrow('Tool testrail_case_write disabled');
    expect(session.calls.some((endpoint) => endpoint.startsWith('update_case'))).toBe(false);
  });

  it('widens the catalogue with the permissions, and only the escape hatch needs admin', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization'] });

    story.given('an editor and an admin against the same server');
    const editorSession = await connectAs(EDITOR);
    const editorTools = await toolNames(editorSession.client);
    editorSession.close();
    const adminSession = await connectAs(ADMIN);
    cleanup = adminSession.close;

    story.when('each lists tools');
    const adminTools = await toolNames(adminSession.client);
    story.table({
      label: 'Catalogue by role',
      columns: ['Role', 'Tools'],
      rows: [
        ['reader', '6'],
        ['editor', String(editorTools.length)],
        ['admin', String(adminTools.length)],
      ],
    });

    story.then('the editor adds the three write tools but not testrail_raw');
    expect(editorTools).toContain('testrail_case_write');
    expect(editorTools).toContain('testrail_run');
    expect(editorTools).toContain('testrail_report_result');
    expect(editorTools).not.toContain('testrail_raw');

    story.and('only the admin reaches anything the other nine tools do not cover');
    expect(adminTools).toHaveLength(10);
    expect(adminTools).toContain('testrail_raw');
  });

  it('fails the boot rather than serve a capability nobody priced', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'authorization', 'safety'], covers: ['src/permissions.ts'] });

    story.given('a connector whose permission map has drifted from the tools');
    const { testrail_raw: _dropped, ...incomplete } = GATE_PERMISSIONS;

    story.when('it builds the server');
    const fake = fakeTestRail(REFERENCE_DATA, { allowWrites: true });

    const build = () =>
      buildServer(TEST_CONFIG, {
        client: fake.client,
        wrap: (built) => gate(built, ADMIN, incomplete),
      });

    story.then('gate() throws, naming the tool, instead of guessing');
    story.note(
      'This is why SECURITY.md can call the map the boundary: a tool added upstream without a ' +
        'price stops the deployment, rather than defaulting to everyone or to nobody in silence.',
    );
    expect(build).toThrow(/testrail_raw/);
    fake.restore();
  });
});
