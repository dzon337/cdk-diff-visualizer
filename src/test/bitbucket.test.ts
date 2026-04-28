import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBitbucketEnv, buildPrUrl, withMarker } from '../bitbucket';

const REQUIRED_ENV = {
  BITBUCKET_PR_ID: '42',
  BITBUCKET_WORKSPACE: 'acme',
  BITBUCKET_REPO_SLUG: 'my-repo',
  BITBUCKET_ACCESS_TOKEN: 'secret-token',
};

describe('resolveBitbucketEnv', () => {
  let saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save and set env vars
    for (const key of Object.keys(REQUIRED_ENV)) {
      saved[key] = process.env[key];
    }
    Object.assign(process.env, REQUIRED_ENV);
  });

  afterEach(() => {
    // Restore
    for (const [key, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }
  });

  test('resolves all fields from environment', () => {
    const env = resolveBitbucketEnv();
    assert.equal(env.prId, '42');
    assert.equal(env.workspace, 'acme');
    assert.equal(env.repoSlug, 'my-repo');
    assert.equal(env.accessToken, 'secret-token');
    assert.equal(env.apiUrl, 'https://api.bitbucket.org/2.0');
  });

  test('throws listing all missing vars', () => {
    delete process.env['BITBUCKET_PR_ID'];
    delete process.env['BITBUCKET_WORKSPACE'];
    try {
      resolveBitbucketEnv();
      assert.fail('should have thrown');
    } catch (err) {
      assert.ok((err as Error).message.includes('BITBUCKET_PR_ID'));
      assert.ok((err as Error).message.includes('BITBUCKET_WORKSPACE'));
    }
  });

  test('overrides take precedence over env', () => {
    const env = resolveBitbucketEnv({ workspace: 'override-workspace' });
    assert.equal(env.workspace, 'override-workspace');
  });

  test('custom apiUrl override works', () => {
    const env = resolveBitbucketEnv({ apiUrl: 'https://internal.company.com/api' });
    assert.equal(env.apiUrl, 'https://internal.company.com/api');
  });
});

describe('buildPrUrl', () => {
  test('builds correct Bitbucket PR URL', () => {
    const env = {
      prId: '99',
      workspace: 'acme',
      repoSlug: 'infra-repo',
      accessToken: 'token',
      apiUrl: 'https://api.bitbucket.org/2.0',
    };
    const url = buildPrUrl(env);
    assert.equal(url, 'https://bitbucket.org/acme/infra-repo/pull-requests/99');
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
