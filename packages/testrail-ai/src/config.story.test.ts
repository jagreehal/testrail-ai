import { story } from 'executable-stories-vitest';
import { describe, expect, it } from 'vitest';
import { loadConfig, type ConfigEnvironment } from './config';

const VALID: ConfigEnvironment = {
  TESTRAIL_URL: 'https://example.testrail.io',
  TESTRAIL_EMAIL: 'qa@example.com',
  TESTRAIL_API_KEY: 'secret',
};

describe('Secure configuration', () => {
  it('requires TLS anywhere except a loopback development server', ({ task }) => {
    story.init(task, { tags: ['security', 'configuration'], covers: ['src/config.ts'] });

    expect(() => loadConfig({ ...VALID, TESTRAIL_URL: 'http://example.testrail.io' })).toThrow(/HTTPS/);
    expect(loadConfig({ ...VALID, TESTRAIL_URL: 'http://127.0.0.1:8080' }).url).toBe('http://127.0.0.1:8080');
    expect(loadConfig({ ...VALID, TESTRAIL_URL: 'http://localhost:8080/' }).url).toBe(
      'http://localhost:8080',
    );
  });

  it('refuses credentials, query strings and fragments in the base URL', ({ task }) => {
    story.init(task, { tags: ['security', 'configuration'] });

    expect(() => loadConfig({ ...VALID, TESTRAIL_URL: 'https://user:pass@example.testrail.io' })).toThrow(
      /must not contain credentials/,
    );
    expect(() => loadConfig({ ...VALID, TESTRAIL_URL: 'https://example.testrail.io?x=1' })).toThrow(
      /query or fragment/,
    );
    expect(() => loadConfig({ ...VALID, TESTRAIL_URL: 'https://example.testrail.io#x' })).toThrow(
      /query or fragment/,
    );
  });

  it('bounds resource and timeout controls', ({ task }) => {
    story.init(task, { tags: ['configuration', 'resilience'] });

    expect(() => loadConfig({ ...VALID, TESTRAIL_MAX_ROWS: '2001' })).toThrow(/maxRows/);
    expect(() => loadConfig({ ...VALID, TESTRAIL_TIMEOUT_MS: '300001' })).toThrow(/timeoutMs/);
  });

  it('reads an optional default project', ({ task }) => {
    story.init(task, { tags: ['configuration'] });

    expect(loadConfig(VALID).defaultProjectId).toBeUndefined();
    expect(loadConfig({ ...VALID, TESTRAIL_PROJECT_ID: ' ' }).defaultProjectId).toBeUndefined();
    expect(loadConfig({ ...VALID, TESTRAIL_PROJECT_ID: '11' }).defaultProjectId).toBe(11);
    expect(() => loadConfig({ ...VALID, TESTRAIL_PROJECT_ID: 'Jag' })).toThrow(/defaultProjectId/);
  });
});
