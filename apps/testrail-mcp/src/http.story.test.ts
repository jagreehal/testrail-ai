import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { request, type IncomingHttpHeaders } from 'node:http';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { story } from 'executable-stories-vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

/**
 * The HTTP entry point, run as the built binary a user would start. Nothing here
 * reaches TestRail: /health and the guards answer before any tool runs.
 */

const ENTRY = fileURLToPath(new URL('../dist/http.js', import.meta.url));

const CONFIG = {
  TESTRAIL_URL: 'https://example.testrail.io',
  TESTRAIL_EMAIL: 'qa@example.com',
  TESTRAIL_API_KEY: 'key',
};

let child: ChildProcess | undefined;

afterEach(() => {
  child?.kill('SIGKILL');
  child = undefined;
});

async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = z.object({ port: z.number() }).parse(probe.address());
  probe.close();

  return port;
}

/** Spawn the server; resolves once it is listening, or with its exit if it dies first. */
async function start(env: Record<string, string>) {
  const proc = spawn(process.execPath, [ENTRY], {
    env: { PATH: process.env.PATH ?? '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child = proc;
  let output = '';
  proc.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  proc.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(proc, 'exit').then(() => ({ code: proc.exitCode }));

  const listening = new Promise<void>((resolve) => {
    proc.stdout.on('data', () => {
      if (output.includes('endpoint')) resolve();
    });
  });

  const outcome = await Promise.race([listening.then(() => 'listening' as const), exited]);

  return { proc, outcome, output: () => output, exited };
}

function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: string; headers: IncomingHttpHeaders }>((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, headers }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
    });

    req.on('error', reject);
    req.end();
  });
}

describe('The HTTP entry point', { timeout: 20_000 }, () => {
  it('answers /health with the instance and write switch, hardened headers included', async ({ task }) => {
    story.init(task, { tags: ['http'], covers: ['src/http.ts'] });

    story.given('the built server on a free loopback port');
    const port = await freePort();
    const server = await start({ ...CONFIG, PORT: String(port) });
    expect(server.outcome, server.output()).toBe('listening');

    story.when('/health is requested');
    const response = await get(port, '/health', { Host: `localhost:${port}` });
    story.json({ label: '/health', value: z.json().parse(JSON.parse(response.body)) });

    story.then('it is 200 JSON naming the instance, with writes off');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      ok: true,
      testrail: 'https://example.testrail.io',
      writes: false,
    });
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
  });

  it('404s any path other than /mcp and /health', async ({ task }) => {
    story.init(task, { tags: ['http'], covers: ['src/http.ts'] });

    story.given('a running server');
    const port = await freePort();
    const server = await start({ ...CONFIG, PORT: String(port) });
    expect(server.outcome, server.output()).toBe('listening');

    story.when('/admin is requested');
    const response = await get(port, '/admin', { Host: `localhost:${port}` });

    story.then('it is Not Found');
    expect(response.status).toBe(404);
    expect(response.body).toBe('Not Found');
  });

  it('refuses a non-localhost Host, the DNS rebinding guard', async ({ task }) => {
    story.init(task, { tags: ['http', 'security'], covers: ['src/http.ts'] });

    story.given('a running server');
    const port = await freePort();
    const server = await start({ ...CONFIG, PORT: String(port) });
    expect(server.outcome, server.output()).toBe('listening');

    story.when('a request arrives addressed to evil.example');
    const response = await get(port, '/health', { Host: 'evil.example' });

    story.then('it is refused before reaching any route');
    expect(response.status).toBe(403);
    expect(response.body).not.toContain('"ok":true');
  });

  it('refuses a cross-site Origin', async ({ task }) => {
    story.init(task, { tags: ['http', 'security'], covers: ['src/http.ts'] });

    story.given('a running server');
    const port = await freePort();
    const server = await start({ ...CONFIG, PORT: String(port) });
    expect(server.outcome, server.output()).toBe('listening');

    story.when('a web page on another origin calls it');

    const response = await get(port, '/health', {
      Host: `localhost:${port}`,
      Origin: 'https://evil.example',
    });

    story.then('it is refused');
    expect(response.status).toBe(403);
    expect(response.body).not.toContain('"ok":true');
  });

  it('exits non-zero on an invalid PORT', async ({ task }) => {
    story.init(task, { tags: ['http', 'config'], covers: ['src/http.ts'] });

    story.given('PORT=70000');
    const server = await start({ ...CONFIG, PORT: '70000' });

    story.then('it exits non-zero, naming the bad value');
    expect(server.outcome).toEqual({ code: 1 });
    expect(server.output()).toContain('PORT must be an integer between 1 and 65535; received 70000.');
  });

  it('exits 1 with setup instructions when TestRail is not configured', async ({ task }) => {
    story.init(task, { tags: ['http', 'config'], covers: ['src/http.ts'] });

    story.given('no TESTRAIL_* variables');
    const server = await start({ PORT: String(await freePort()) });

    story.then('it exits 1 and says which variables to set');
    expect(server.outcome).toEqual({ code: 1 });
    expect(server.output()).toContain('TestRail MCP is not configured.');
    expect(server.output()).toContain('Set TESTRAIL_URL, TESTRAIL_EMAIL and TESTRAIL_API_KEY');
  });

  it('drains and exits 0 on SIGTERM', async ({ task }) => {
    story.init(task, { tags: ['http', 'lifecycle'], covers: ['src/http.ts'] });

    story.given('a running server');
    const port = await freePort();
    const server = await start({ ...CONFIG, PORT: String(port) });
    expect(server.outcome, server.output()).toBe('listening');

    story.when('it receives SIGTERM');
    server.proc.kill('SIGTERM');

    story.then('it logs the drain and exits cleanly');
    expect(await server.exited).toEqual({ code: 0 });
    expect(server.output()).toContain('[http] SIGTERM; draining connections');
  });
});
