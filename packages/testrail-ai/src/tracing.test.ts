import { context, SpanStatusCode, trace } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakeTestRail, page, TEST_CONFIG } from './test-support';

const exporter = new InMemorySpanExporter();

beforeAll(() => {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
});

afterAll(() => {
  trace.disable();
  context.disable();
});

beforeEach(() => {
  exporter.reset();
});

describe('Tracing TestRail requests', () => {
  it('gives each request a client span named by operation, with ids kept to attributes', async () => {
    const fake = fakeTestRail({
      'get_cases/5&limit=3': page('cases', [{ id: 1 }, { id: 2 }], '/api/v2/get_cases/5&limit=3&offset=2'),
      'get_cases/5&limit=3&offset=2': page('cases', [{ id: 3 }]),
    });

    await fake.client.list('get_cases/5', 'cases', 3);

    const spans = exporter.getFinishedSpans();

    expect(spans.map((span) => span.name)).toEqual(['testrail get_cases', 'testrail get_cases']);
    expect(spans[1]?.attributes).toEqual({
      'http.request.method': 'GET',
      'server.address': new URL(TEST_CONFIG.url).host,
      'testrail.endpoint': 'get_cases/5&limit=3&offset=2',
      'http.response.status_code': 200,
    });
  });

  it('records retries as events on the one span', async () => {
    let calls = 0;

    const fake = fakeTestRail({
      get_project: () =>
        ++calls === 1
          ? new Response('', { status: 429, headers: { 'Retry-After': '0' } })
          : Response.json({ id: 5 }),
    });

    await fake.client.request('get_project/5');

    const [span] = exporter.getFinishedSpans();

    expect(
      span?.events.map((event) => [event.name, event.attributes?.['http.response.status_code']]),
    ).toEqual([['retry', 429]]);
    expect(span?.status.code).not.toBe(SpanStatusCode.ERROR);
  });

  it('marks failures with a status and error type, and never records the credential', async () => {
    const fake = fakeTestRail({});

    await expect(fake.client.request('get_run/404')).rejects.toThrow(/TestRail 404 on get_run\/404/);
    await expect(fake.client.request('add_run/5', { name: 'x' })).rejects.toThrow(/Writes are disabled/);

    const [notFound, refused] = exporter.getFinishedSpans();

    expect(notFound?.status.code).toBe(SpanStatusCode.ERROR);
    expect(notFound?.attributes['error.type']).toBe('404');
    expect(refused?.attributes['error.type']).toBe('write_disabled');

    const recorded = JSON.stringify(
      exporter.getFinishedSpans().map((span) => [span.attributes, span.events]),
    );

    expect(recorded).not.toContain(TEST_CONFIG.apiKey);
    expect(recorded).not.toContain(TEST_CONFIG.email);
  });
});
