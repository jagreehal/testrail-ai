import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport, type McpServer } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import { fakeTestRail, page, TEST_CONFIG } from 'testrail-ai/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server';
import { loadTelemetry } from './telemetry';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('Telemetry', () => {
  it('loads nothing without an OTLP endpoint', async ({ task }) => {
    story.init(task, { tags: ['telemetry'], covers: ['src/telemetry.ts'] });

    story.given('no OTEL_EXPORTER_OTLP_ENDPOINT');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', '');

    story.then('there is nothing to wrap the server with');
    expect(await loadTelemetry()).toBeUndefined();
  });

  it('instruments the server before its tools register, and serves through it', async ({ task }) => {
    story.init(task, { tags: ['telemetry'], covers: ['src/telemetry.ts', 'src/server.ts'] });

    story.given('an OTLP endpoint');
    vi.stubEnv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://127.0.0.1:4318');
    const instrument = await loadTelemetry();
    expect(instrument).toBeTypeOf('function');

    story.when('the server is built with it as the wrap');
    let instrumented: McpServer | undefined;

    const fake = fakeTestRail({
      get_statuses: [{ id: 1, name: 'passed', label: 'Passed', is_final: true, is_untested: false }],
      get_priorities: [],
      get_case_types: [],
      get_users: page('users', []),
      get_projects: page('projects', [{ id: 5, name: 'Core', suite_mode: 1 }]),
    });

    const server = buildServer(TEST_CONFIG, {
      client: fake.client,
      wrap: (built) => (instrumented = instrument!(built)),
    });

    story.then('buildServer returns the instrumented proxy, so every handler registered through it');
    expect(instrumented).toBeDefined();
    expect(server).toBe(instrumented);

    story.and('tools still answer through it');
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'test', version: '1.0.0' });
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'testrail_search', arguments: { entity: 'projects' } });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain('Core');
    await client.close();
    await server.close();
    fake.restore();
  });
});
