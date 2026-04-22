import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from '../config';

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdk-diff-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('returns defaults when no rc file exists', () => {
    const config = loadConfig(tmpDir);
    assert.deepEqual(config.cdkArgs, ['--all']);
    assert.equal(config.dryRun, false);
    assert.equal(config.bitbucketApiUrl, 'https://api.bitbucket.org/2.0');
  });

  test('merges rc file over defaults', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.cdkdiffreportrc'),
      JSON.stringify({ cdkArgs: ['--all', '--context', 'env=prod'], htmlOutput: 'report.html' })
    );
    const config = loadConfig(tmpDir);
    assert.deepEqual(config.cdkArgs, ['--all', '--context', 'env=prod']);
    assert.equal(config.htmlOutput, 'report.html');
    assert.equal(config.dryRun, false); // default preserved
  });

  test('reads .cdkdiffreportrc.json too', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.cdkdiffreportrc.json'),
      JSON.stringify({ dryRun: true })
    );
    const config = loadConfig(tmpDir);
    assert.equal(config.dryRun, true);
  });

  test('throws on malformed JSON', () => {
    fs.writeFileSync(path.join(tmpDir, '.cdkdiffreportrc'), '{ bad json }');
    assert.throws(() => loadConfig(tmpDir), /Failed to parse/);
  });

  test('dryRun can be set to true', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.cdkdiffreportrc'),
      JSON.stringify({ dryRun: true })
    );
    const config = loadConfig(tmpDir);
    assert.equal(config.dryRun, true);
  });

  test('custom bitbucketApiUrl is respected', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.cdkdiffreportrc'),
      JSON.stringify({ bitbucketApiUrl: 'https://bitbucket.mycompany.com/rest/api/2.0' })
    );
    const config = loadConfig(tmpDir);
    assert.equal(config.bitbucketApiUrl, 'https://bitbucket.mycompany.com/rest/api/2.0');
  });
});
