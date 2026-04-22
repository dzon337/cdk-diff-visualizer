import fs from 'fs';
import path from 'path';

export interface Config {
  /** Args forwarded verbatim to `cdk diff`, e.g. ["--all", "--context", "env=prod"] */
  cdkArgs: string[];
  /** Bitbucket workspace slug. Defaults to BITBUCKET_WORKSPACE env var. */
  workspace?: string;
  /** Bitbucket repo slug. Defaults to BITBUCKET_REPO_SLUG env var. */
  repoSlug?: string;
  /** Bitbucket API base URL. Defaults to https://api.bitbucket.org/2.0 */
  bitbucketApiUrl?: string;
  /** If true, skip posting the PR comment (useful for local runs) */
  dryRun?: boolean;
  /** Output HTML report to this file path in addition to posting the comment */
  htmlOutput?: string;
}

const DEFAULTS: Config = {
  cdkArgs: ['--all'],
  bitbucketApiUrl: 'https://api.bitbucket.org/2.0',
  dryRun: false,
};

const RC_FILENAMES = ['.cdkdiffreportrc', '.cdkdiffreportrc.json'];

export function loadConfig(cwd = process.cwd()): Config {
  for (const filename of RC_FILENAMES) {
    const filePath = path.join(cwd, filename);
    if (fs.existsSync(filePath)) {
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        const userConfig = JSON.parse(raw) as Partial<Config>;
        return { ...DEFAULTS, ...userConfig };
      } catch (err) {
        throw new Error(`Failed to parse ${filename}: ${(err as Error).message}`);
      }
    }
  }
  return { ...DEFAULTS };
}
