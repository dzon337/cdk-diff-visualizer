import fs from 'fs';
import path from 'path';

export interface Config {
  cdkArgs: string[];
  workspace?: string;
  repoSlug?: string;
  bitbucketApiUrl?: string;
  dryRun?: boolean;
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
