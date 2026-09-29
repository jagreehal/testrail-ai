#!/usr/bin/env node
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { loadConfig, type Config } from 'testrail-ai';
import { buildServer } from './server';
import { loadTelemetry } from './telemetry';

/**
 * The stdio entry point — how a local MCP client (Claude Code, Claude Desktop,
 * Cursor) runs this server: it spawns the process and talks over stdin/stdout.
 *
 * NOTHING may be written to stdout except protocol frames. A stray console.log
 * corrupts the stream and the client sees a parse error rather than your
 * message. Everything diagnostic goes to stderr.
 */

let config: Config;

try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

console.error(`testrail-ai-mcp → ${config.url} (writes ${config.allowWrites ? 'ENABLED' : 'disabled'})`);

const instrument = await loadTelemetry();

// A factory, not an instance — the same shape the HTTP entry point uses, so the
// two transports cannot drift apart in what they expose.
serveStdio(() => buildServer(config, { wrap: instrument }));
