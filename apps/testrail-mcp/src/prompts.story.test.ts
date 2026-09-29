import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { story } from 'executable-stories-vitest';
import { fakeTestRail, page, TEST_CONFIG, type Route } from 'testrail-ai/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from './server';

/**
 * Prompts are chosen by a human, so their arguments get completion and their
 * text tells the model exactly which tools to call with which ids.
 */

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

const PROJECTS = page('projects', [
  { id: 5, name: 'Curve Core', suite_mode: 1, is_completed: false },
  { id: 6, name: 'Curve Pay', suite_mode: 1, is_completed: false },
  { id: 51, name: 'Ledger', suite_mode: 1, is_completed: false },
]);

async function connect(routes: Record<string, Route> = { get_projects: PROJECTS }) {
  const fake = fakeTestRail(routes);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildServer(TEST_CONFIG, { client: fake.client });
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(clientTransport);
  cleanup = () => {
    void client.close();
    void server.close();
  };

  const prompt = async (name: string, args: Record<string, string>) => {
    const { messages } = await client.getPrompt({ name, arguments: args });

    return messages.map((message) => ('text' in message.content ? message.content.text : '')).join('\n');
  };

  const complete = async (name: string, value: string) => {
    const { completion } = await client.complete({
      ref: { type: 'ref/prompt', name },
      argument: { name: 'project_id', value },
    });

    return completion.values;
  };

  return { prompt, complete };
}

describe('QA workflow prompts', () => {
  it('triage_run walks the model through report, failures and case detail for one run', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts'], covers: ['src/prompts.ts'] });

    story.given('a connected client');
    const { prompt } = await connect();

    story.when('triage_run is requested for run 612');
    const text = await prompt('triage_run', { run_id: '612' });
    story.code({ label: 'Prompt', content: text, lang: 'markdown' });

    story.then('it names the run and the tools in order');
    expect(text).toContain('Triage TestRail run 612.');
    expect(text).toContain('`testrail_run_report` with run_id 612');
    expect(text).toContain('`testrail_failures` with run_id 612 and include_last_good true');
  });

  it('regression_summary defaults to five runs', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts'], covers: ['src/prompts.ts'] });

    story.given('a connected client');
    const { prompt } = await connect();

    story.when('regression_summary is requested without a run count');
    const text = await prompt('regression_summary', { project_id: '5' });

    story.then('it covers the last five runs of the project');
    expect(text).toContain('for TestRail project 5 covering the last 5 runs.');
    expect(text).toContain('`testrail_flaky` with project_id 5 and runs 5');
  });

  it('regression_summary honours an explicit run count', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts'], covers: ['src/prompts.ts'] });

    story.given('a connected client');
    const { prompt } = await connect();

    story.when('regression_summary is requested for 10 runs');
    const text = await prompt('regression_summary', { project_id: '5', runs: '10' });

    story.then('every tool call uses ten');
    expect(text).toContain('covering the last 10 runs.');
    expect(text).toContain('project_id 5, limit 10');
    expect(text).toContain('runs 10');
  });

  it('coverage_gap passes requirement keys through as a trimmed list', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts'], covers: ['src/prompts.ts'] });

    story.given('a connected client');
    const { prompt } = await connect();

    story.when('coverage_gap is requested with refs " RP-100, RP-101"');
    const withRefs = await prompt('coverage_gap', { project_id: '5', refs: ' RP-100, RP-101' });
    const without = await prompt('coverage_gap', { project_id: '5' });
    story.code({ label: 'Prompt', content: withRefs, lang: 'markdown' });

    story.then('the refs become a quoted, trimmed array, and are omitted when absent');
    expect(withRefs).toContain(
      '`testrail_coverage` with project_id 5, refs ["RP-100", "RP-101"], and recent_runs 5.',
    );
    expect(without).toContain('`testrail_coverage` with project_id 5, and recent_runs 5.');
  });

  it('completes a project argument by id prefix or by name', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts', 'completion'], covers: ['src/prompts.ts'] });

    story.given('projects 5 Curve Core, 6 Curve Pay and 51 Ledger');
    const { complete } = await connect();

    story.when('the human types part of an id or a name');
    const byId = await complete('regression_summary', '5');
    const byName = await complete('coverage_gap', 'pay');
    story.json({ label: 'Completions', value: { '5': byId, pay: byName } });

    story.then('an id prefix matches every id starting with it, and names match case-insensitively');
    expect(byId).toEqual(['5', '51']);
    expect(byName).toEqual(['6']);
  });

  it('offers no completions rather than failing when TestRail is unreachable', async ({ task }) => {
    story.init(task, { tags: ['mcp', 'prompts', 'completion', 'errors'], covers: ['src/prompts.ts'] });

    story.given('get_projects fails');

    const { complete } = await connect({
      get_projects: () => new Response(JSON.stringify({ error: 'down' }), { status: 400 }),
    });

    story.when('completion is requested');
    const values = await complete('regression_summary', 'c');

    story.then('the list is empty and the prompt menu keeps working');
    expect(values).toEqual([]);
  });
});
