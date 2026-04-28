import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveGitLabEnv, buildGitLabMrUrl, withMarker } from '../gitlab';

const REQUIRED_ENV = {
  CI_PROJECT_ID: '12345',
  CI_MERGE_REQUEST_IID: '42',
  GITLAB_TOKEN: 'glpat-secret-token',
};

describe('resolveGitLabEnv', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(REQUIRED_ENV)) {
      saved[key] = process.env[key];
    }
    // Also save CI_JOB_TOKEN and CI_API_V4_URL in case they're set
    saved['CI_JOB_TOKEN'] = process.env['CI_JOB_TOKEN'];
    saved['CI_API_V4_URL'] = process.env['CI_API_V4_URL'];
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test('resolves all fields from environment', () => {
    const env = resolveGitLabEnv();
    assert.equal(env.projectId, '12345');
    assert.equal(env.mrIid, '42');
    assert.equal(env.token, 'glpat-secret-token');
    assert.equal(env.apiUrl, 'https://gitlab.com/api/v4');
  });

  test('throws listing all missing vars', () => {
    delete process.env['CI_PROJECT_ID'];
    delete process.env['CI_MERGE_REQUEST_IID'];
    delete process.env['GITLAB_TOKEN'];
    delete process.env['CI_JOB_TOKEN'];
    try {
      resolveGitLabEnv();
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok((err as Error).message.includes('CI_PROJECT_ID'));
      assert.ok((err as Error).message.includes('CI_MERGE_REQUEST_IID'));
      assert.ok((err as Error).message.includes('GITLAB_TOKEN'));
    }
  });

  test('falls back to CI_JOB_TOKEN when GITLAB_TOKEN is unset', () => {
    delete process.env['GITLAB_TOKEN'];
    process.env['CI_JOB_TOKEN'] = 'job-token-value';
    const env = resolveGitLabEnv();
    assert.equal(env.token, 'job-token-value');
  });

  test('uses CI_API_V4_URL when set', () => {
    process.env['CI_API_V4_URL'] = 'https://gitlab.mycompany.com/api/v4';
    const env = resolveGitLabEnv();
    assert.equal(env.apiUrl, 'https://gitlab.mycompany.com/api/v4');
  });

  test('overrides take precedence over env', () => {
    const env = resolveGitLabEnv({ projectId: '99999' });
    assert.equal(env.projectId, '99999');
  });

  test('custom apiUrl override works', () => {
    const env = resolveGitLabEnv({ apiUrl: 'https://internal.gitlab.com/api/v4' });
    assert.equal(env.apiUrl, 'https://internal.gitlab.com/api/v4');
  });
});

describe('buildGitLabMrUrl', () => {
  test('builds correct GitLab MR URL', () => {
    const env = {
      projectId: '12345',
      mrIid: '99',
      token: 'token',
      apiUrl: 'https://gitlab.com/api/v4',
    };
    const url = buildGitLabMrUrl(env);
    assert.equal(url, 'https://gitlab.com/projects/12345/merge_requests/99');
  });

  test('builds correct URL for self-managed instance', () => {
    const env = {
      projectId: '42',
      mrIid: '7',
      token: 'token',
      apiUrl: 'https://gitlab.mycompany.com/api/v4',
    };
    const url = buildGitLabMrUrl(env);
    assert.equal(url, 'https://gitlab.mycompany.com/projects/42/merge_requests/7');
  });

  test('URL-encodes project ID with slashes', () => {
    const env = {
      projectId: 'group/subgroup/project',
      mrIid: '3',
      token: 'token',
      apiUrl: 'https://gitlab.com/api/v4',
    };
    const url = buildGitLabMrUrl(env);
    assert.ok(url.includes(encodeURIComponent('group/subgroup/project')));
    assert.ok(url.includes('/merge_requests/3'));
  });
});

describe('withMarker', () => {
  test('prepends hidden HTML comment marker', () => {
    const result = withMarker('## Report\nSome content');
    assert.ok(result.startsWith('<!-- cdk-diff-report -->'));
    assert.ok(result.includes('## Report'));
    assert.ok(result.includes('Some content'));
  });

  test('marker is on its own line', () => {
    const result = withMarker('body');
    const lines = result.split('\n');
    assert.equal(lines[0], '<!-- cdk-diff-report -->');
    assert.equal(lines[1], 'body');
  });
});
