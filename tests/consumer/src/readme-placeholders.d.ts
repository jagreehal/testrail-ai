import type { Principal } from 'mcp-authz';
import type { Config } from 'testrail-ai';

/** Values the README examples leave to the reader. Global, so every snippet sees them. */
declare global {
  const config: Config;

  const principal: Principal;

  function verifiedEmail(request: Request | undefined): Promise<string>;

  function credentialFor(email: string): Promise<{ email: string; apiKey: string } | undefined>;
}
