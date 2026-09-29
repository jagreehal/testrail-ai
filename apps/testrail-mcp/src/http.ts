import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { loadConfig } from 'testrail-ai';
import { buildServer } from './server';
import { loadTelemetry } from './telemetry';

/**
 * The HTTP entry point: one local process, for the MCP Inspector and for
 * clients that speak HTTP instead of stdio. It binds loopback and rejects
 * non-localhost hosts, so it is a local transport, not a team deployment.
 *
 * That is a decision, not an omission. `loadConfig()` runs once here and the
 * factory closes over the result, so the process holds exactly one TestRail
 * credential. Exposing it to a team would run everyone's queries under that one
 * service account: TestRail's per-project permissions would stop applying and
 * the audit trail would name one person for all of it. Authentication in front
 * of the port would gate who reaches the shared account without fixing either
 * problem.
 *
 * That limit belongs to this entry point, not to the package. The factory
 * receives `ctx.requestInfo`, the original Request, so a deployment that has
 * already authenticated the caller can map that identity to their own TestRail
 * credential and build a per-request config:
 *
 *   createMcpHandler((ctx) => {
 *     const who = verifiedEmailFrom(ctx.requestInfo);        // your SSO
 *     const { email, apiKey } = credentialFor(who);          // your secret store
 *     return buildServer(loadConfig({ ...process.env,
 *       TESTRAIL_EMAIL: email, TESTRAIL_API_KEY: apiKey }));
 *   });
 *
 * `loadConfig` takes an env object rather than reading `process.env` itself,
 * so that path keeps the same validation this one gets. See the README.
 *
 * The host and origin guards are not optional decoration: without them any web
 * page the user visits can POST to localhost and drive this server through the
 * browser (DNS rebinding). They answer rejected requests themselves.
 */
const config = (() => {
  try {
    return loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();

const port = Number(process.env.PORT ?? 8100);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error(`PORT must be an integer between 1 and 65535; received ${String(process.env.PORT)}.`);
}

const instrument = await loadTelemetry();

const handler = createMcpHandler(() => buildServer(config, { wrap: instrument }), {
  onerror: (error) => console.error('[mcp]', error.message),
});

const nodeHandler = toNodeHandler(handler);

const checkHost = localhostHostValidation();

const checkOrigin = localhostOriginValidation();

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');

    if (!checkHost(request, response) || !checkOrigin(request, response)) return;

    const { pathname } = new URL(request.url ?? '/', `http://localhost:${port}`);

    if (pathname === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, testrail: config.url, writes: config.allowWrites }));

      return;
    }

    if (pathname !== '/mcp') {
      response.writeHead(404).end('Not Found');

      return;
    }

    await nodeHandler(request, response);
  } catch (error) {
    console.error('[http]', error);

    if (!response.headersSent) response.writeHead(500);
    response.end('Internal Server Error');
  }
}

// `handle` answers every error itself, so there is nothing for the caller to await.
const http = createServer((request, response) => void handle(request, response));

// Handlers go in before the server binds, never after the banner: a supervisor
// may signal the moment it reads "endpoint", and a SIGTERM landing before
// `process.once` would kill the process undrained.
let stopping = false;

function shutdown(signal: NodeJS.Signals): void {
  if (stopping) return;
  stopping = true;

  // Not yet bound: nothing to drain, and `close` would report ERR_SERVER_NOT_RUNNING.
  if (!http.listening) process.exit(0);
  console.error(`[http] ${signal}; draining connections`);
  http.close((error) => {
    if (error) console.error('[http] shutdown failed', error);
    process.exitCode = error ? 1 : 0;
  });
  setTimeout(() => http.closeAllConnections(), 10_000).unref();
}

process.once('SIGINT', () => shutdown('SIGINT'));

process.once('SIGTERM', () => shutdown('SIGTERM'));

// Bind loopback explicitly. Left alone Node binds dual-stack, and on macOS that
// can "succeed" while another process holds the IPv6 side of the same port —
// giving you a server nobody can reach instead of a clear EADDRINUSE.
await new Promise<void>((resolve, reject) => {
  http.once('error', reject);
  http.listen(port, '127.0.0.1', () => {
    http.off('error', reject);
    resolve();
  });
});

console.log(`\n🧪 TestRail MCP server`);

console.log(`   endpoint  http://localhost:${port}/mcp`);

console.log(`   health    http://localhost:${port}/health`);

console.log(`   testrail  ${config.url}`);

console.log(`   writes    ${config.allowWrites ? 'ENABLED' : 'disabled'}`);

console.log(`   protocol  2026-07-28 (2025-era clients via the stateless legacy fallback)\n`);
