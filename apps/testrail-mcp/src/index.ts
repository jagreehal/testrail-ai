/**
 * Programmatic entry point, for embedding the server rather than spawning it.
 * The two transports live in `stdio.ts` and `http.ts`.
 */
export { buildServer, SERVER_INFO, type BuildServerOptions } from './server';

export { GATE_PERMISSIONS, type GatePermission } from './permissions';

export { registerPrompts } from './prompts';

export { registerResources } from './resources';

export { registerTools } from './tools';

export { loadTelemetry } from './telemetry';
