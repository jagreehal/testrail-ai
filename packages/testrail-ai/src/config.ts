import { z } from 'zod';

/**
 * Configuration comes from the environment, because that is the only channel a
 * stdio client (Claude Desktop, Claude Code, Cursor) can pass secrets over.
 *
 * Writes are OFF unless `TESTRAIL_ALLOW_WRITES=true`. A read-only server cannot
 * be talked into mutating a shared QA instance by a confused model, and most
 * uses of this server — triage, reporting, coverage — never need writes.
 */
const ConfigSchema = z.object({
  url: z
    .string()
    .trim()
    .url('TESTRAIL_URL must be a full URL, e.g. https://example.testrail.io')
    .transform((value, context) => {
      const url = new URL(value);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);

      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
        context.addIssue({
          code: 'custom',
          message: 'TESTRAIL_URL must use HTTPS (HTTP is allowed only for localhost)',
        });

        return z.NEVER;
      }

      if (url.username || url.password) {
        context.addIssue({ code: 'custom', message: 'TESTRAIL_URL must not contain credentials' });

        return z.NEVER;
      }

      if (url.search || url.hash) {
        context.addIssue({ code: 'custom', message: 'TESTRAIL_URL must not contain a query or fragment' });

        return z.NEVER;
      }

      // Trailing slashes turn `/index.php` into `//index.php`, which TestRail 404s.
      return value.replace(/\/+$/, '');
    }),
  email: z.string().min(1, 'TESTRAIL_EMAIL is required'),
  apiKey: z.string().min(1, 'TESTRAIL_API_KEY is required'),
  allowWrites: z.boolean(),
  /** Cap on rows any single tool will pull back, so one call cannot blow the context window. */
  maxRows: z.number().int().positive().max(2000),
  timeoutMs: z.number().int().positive().max(300_000),
  /**
   * The project the MCP server and CLI use when a call leaves `project_id` out.
   * The library functions never apply it: a caller of `getStability` says which
   * project it means.
   */
  defaultProjectId: z
    .number({ error: 'TESTRAIL_PROJECT_ID must be a project id, e.g. 5' })
    .int()
    .positive()
    .optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export type ConfigEnvironment = Record<string, string | undefined>;

export function loadConfig(
  env: ConfigEnvironment = typeof process === 'undefined' ? {} : process.env,
): Config {
  const parsed = ConfigSchema.safeParse({
    url: env.TESTRAIL_URL,
    // TESTRAIL_USERNAME is what the older community servers called it; accept both
    // so an existing client config keeps working.
    email: env.TESTRAIL_EMAIL ?? env.TESTRAIL_USERNAME,
    apiKey: env.TESTRAIL_API_KEY,
    allowWrites: env.TESTRAIL_ALLOW_WRITES === 'true',
    maxRows: Number(env.TESTRAIL_MAX_ROWS ?? 250),
    timeoutMs: Number(env.TESTRAIL_TIMEOUT_MS ?? 30_000),
    defaultProjectId: env.TESTRAIL_PROJECT_ID?.trim() ? Number(env.TESTRAIL_PROJECT_ID) : undefined,
  });

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');

    throw new Error(
      `TestRail MCP is not configured.\n${problems}\n\n` +
        'Set TESTRAIL_URL, TESTRAIL_EMAIL and TESTRAIL_API_KEY in the environment: ' +
        "the env block of your MCP client's config, or your shell. To load them from a file, run testrail-ai-mcp --env-file <absolute path>.",
    );
  }

  return parsed.data;
}
