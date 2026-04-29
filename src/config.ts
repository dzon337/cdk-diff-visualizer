/**
 * RC file loader — reads .cdkdiffreportrc / .cdkdiffreportrc.json from the project root.
 * All config fields can be overridden via environment variables (CDK_DIFF_*).
 * @module config
 */

import fs from 'fs';
import path from 'path';

export interface Config {
  cdkArgs: string[];
  platform?: 'bitbucket' | 'github' | 'gitlab';
  workspace?: string;
  repoSlug?: string;
  bitbucketApiUrl?: string;
  gitlabApiUrl?: string;
  dryRun?: boolean;
  htmlOutput?: string;
}

const DEFAULTS: Config = { cdkArgs: ['--all'], platform: 'bitbucket', bitbucketApiUrl: 'https://api.bitbucket.org/2.0', dryRun: false };
const RC_FILENAMES = ['.cdkdiffreportrc', '.cdkdiffreportrc.json'];

/** Load configuration: defaults ← .cdkdiffreportrc ← CDK_DIFF_* env vars. */
export function loadConfig(cwd = process.cwd()): Config {
  let config = { ...DEFAULTS };

  for (const f of RC_FILENAMES) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) {
      try { config = { ...config, ...JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<Config> }; }
      catch (e) { throw new Error(`Failed to parse ${f}: ${(e as Error).message}`); }
      break;
    }
  }

  const env = process.env;
  if (env['CDK_DIFF_PLATFORM']) config.platform = env['CDK_DIFF_PLATFORM'] as Config['platform'];
  if (env['CDK_DIFF_CDK_ARGS']) config.cdkArgs = env['CDK_DIFF_CDK_ARGS'].split(',').map((s) => s.trim());
  if (env['CDK_DIFF_HTML_OUTPUT']) config.htmlOutput = env['CDK_DIFF_HTML_OUTPUT'];
  if (env['CDK_DIFF_DRY_RUN']) config.dryRun = env['CDK_DIFF_DRY_RUN'] === 'true';
  if (env['CDK_DIFF_WORKSPACE']) config.workspace = env['CDK_DIFF_WORKSPACE'];
  if (env['CDK_DIFF_REPO_SLUG']) config.repoSlug = env['CDK_DIFF_REPO_SLUG'];
  if (env['CDK_DIFF_BITBUCKET_API_URL']) config.bitbucketApiUrl = env['CDK_DIFF_BITBUCKET_API_URL'];
  if (env['CDK_DIFF_GITLAB_API_URL']) config.gitlabApiUrl = env['CDK_DIFF_GITLAB_API_URL'];

  return config;
}
