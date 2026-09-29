import type { McpServer } from '@modelcontextprotocol/server';

/**
 * Optional OpenTelemetry, off unless an endpoint is configured.
 *
 * An MCP server is a black box to the person running it: they see the model's
 * answer, never the eleven TestRail round trips behind it. Tracing is how "the
 * run report is slow" becomes "get_tests took 4s on a 986-test run": the tool
 * call is a span here, and the core client adds a span per TestRail request.
 *
 * `autotel` and `autotel-mcp-instrumentation` are imported dynamically so a user
 * who never sets OTEL_EXPORTER_OTLP_ENDPOINT pays nothing — no OTel SDK loaded,
 * no startup cost, and a stdio server that stays silent on stdout.
 *
 * Call this once per process and pass the result to `buildServer` as `wrap`.
 * The instrumentation is a Proxy that wraps each handler as it registers, so it
 * must see the server before any tool does. To combine it with `gate()`, wrap
 * the gate around it: `wrap: (server) => gate(instrument(server), …)`.
 */
export async function loadTelemetry(): Promise<((server: McpServer) => McpServer) | undefined> {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  if (!endpoint) return undefined;

  try {
    const [{ init }, { instrumentMcpServer }, { heuristicInjectionClassifier }] = await Promise.all([
      import('autotel'),
      import('autotel-mcp-instrumentation/server'),
      import('autotel-mcp-instrumentation/security'),
    ]);

    init({
      service: process.env.OTEL_SERVICE_NAME ?? 'testrail-ai-mcp',
      endpoint,
    });

    console.error(`[telemetry] tracing to ${endpoint}`);

    // The Proxy also propagates W3C trace context through MCP's `_meta`, so a
    // trace started in the client carries through into the TestRail calls.
    //
    // The tools hand the model text that anyone on the TestRail instance can
    // write: case titles, steps, result comments. The classifier scans each
    // result for injection attempts and records `mcp.security.injection.*` on
    // the span. It is a tripwire for alerting, not a filter: the result the
    // model reads is unchanged.
    return (server) => instrumentMcpServer(server, { securityClassifier: heuristicInjectionClassifier() });
  } catch (error) {
    // Telemetry must never take the server down with it.
    console.error(`[telemetry] disabled — ${error instanceof Error ? error.message : String(error)}`);

    return undefined;
  }
}
