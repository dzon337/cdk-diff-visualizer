/**
 * RC file loader — reads .cdkdiffreportrc / .cdkdiffreportrc.json from the project root.
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

/** Load configuration from .cdkdiffreportrc in the given directory. */
export function loadConfig(cwd = process.cwd()): Config {
  for (const f of RC_FILENAMES) {
    const p = path.join(cwd, f);
    if (fs.existsSync(p)) {
      try { return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf-8')) as Partial<Config> }; }
      catch (e) { throw new Error(`Failed to parse ${f}: ${(e as Error).message}`); }
    }
  }
  return { ...DEFAULTS };
}
