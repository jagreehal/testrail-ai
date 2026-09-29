import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { TEST_CONFIG } from 'testrail-ai/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from './server';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Per-request servers', () => {
  it('share one client per config, so reference data loads once across requests', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', (input: string | URL | Request) => {
      const endpoint = String(input instanceof Request ? input.url : input).split('/api/v2/')[1] ?? '';
      calls.push(endpoint);

      const body = endpoint.startsWith('get_projects')
        ? {
            offset: 0,
            limit: 250,
            size: 1,
            _links: { next: null },
            projects: [{ id: 5, name: 'Core', suite_mode: 1 }],
          }
        : endpoint.startsWith('get_users')
          ? { offset: 0, limit: 250, size: 0, _links: { next: null }, users: [] }
          : [];

      return Promise.resolve(Response.json(body));
    });

    // A config no other test builds, so the shared client starts cold.
    const config = { ...TEST_CONFIG, url: 'https://reuse.testrail.io' };

    for (let request = 0; request < 2; request++) {
      const server = buildServer({ ...config });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      await server.connect(serverTransport);
      const client = new Client({ name: 'test', version: '1.0.0' });
      await client.connect(clientTransport);
      const result = await client.callTool({ name: 'testrail_search', arguments: { entity: 'projects' } });
      expect(result.isError).not.toBe(true);
      await client.close();
      await server.close();
    }

    expect(calls.filter((endpoint) => endpoint === 'get_statuses')).toHaveLength(1);
    expect(calls.filter((endpoint) => endpoint.startsWith('get_projects'))).toHaveLength(2);
  });
});
