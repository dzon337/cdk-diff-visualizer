#!/usr/bin/env node
import { run } from './runner';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dry');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
cdk-diff-report

Runs \`cdk diff\` (using args from .cdkdiffreportrc), streams output to the
console, then posts a formatted summary comment to the Bitbucket pull request.

Usage:
  cdk-diff-report              Run diff and post PR comment
  cdk-diff-report --dry-run    Run diff, print markdown preview, skip posting
  cdk-diff-report --help       Show this help

Configuration (.cdkdiffreportrc in project root):
  {
    "cdkArgs": ["--all"],           // args forwarded to cdk diff
    "htmlOutput": "cdk-diff.html",  // optional: write HTML report to file
    "dryRun": false                 // optional: never post, just preview
  }

Required environment variables (set automatically by Bitbucket Pipelines):
  BITBUCKET_PR_ID
  BITBUCKET_WORKSPACE
  BITBUCKET_REPO_SLUG
  BITBUCKET_ACCESS_TOKEN          // create a repository access token in Bitbucket
`);
  process.exit(0);
}

run({ dryRun }).catch((err: Error) => {
  console.error(`\n❌  cdk-diff-report failed: ${err.message}\n`);
  process.exit(1);
});
