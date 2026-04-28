#!/usr/bin/env node
import { run } from './runner';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dry');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
cdk-diff-report

Runs \`cdk diff\` (using args from .cdkdiffreportrc), streams output to the
console, then posts a formatted summary comment to your pull request.

Supports Bitbucket, GitHub, and GitLab. On repeated runs the existing comment is
updated in-place (upsert) instead of creating duplicates.

Usage:
  cdk-diff-report              Run diff and post/update PR comment
  cdk-diff-report --dry-run    Run diff, print markdown preview, skip posting
  cdk-diff-report --help       Show this help

Configuration (.cdkdiffreportrc in project root):
  {
    "platform": "bitbucket",        // "bitbucket" (default), "github", or "gitlab"
    "cdkArgs": ["--all"],           // args forwarded to cdk diff
    "htmlOutput": "cdk-diff.html",  // optional: write HTML report to file
    "dryRun": false                 // optional: never post, just preview
  }

Bitbucket env vars (set automatically by Bitbucket Pipelines):
  BITBUCKET_PR_ID
  BITBUCKET_WORKSPACE
  BITBUCKET_REPO_SLUG
  BITBUCKET_ACCESS_TOKEN          // repository access token with pullrequest:write

GitHub env vars (set automatically by GitHub Actions):
  GITHUB_REF                      // or GITHUB_PR_NUMBER
  GITHUB_REPOSITORY
  GITHUB_REPOSITORY_OWNER
  GITHUB_TOKEN

GitLab env vars (set automatically by GitLab CI merge request pipelines):
  CI_PROJECT_ID
  CI_MERGE_REQUEST_IID
  GITLAB_TOKEN                    // or CI_JOB_TOKEN (needs api scope)
  CI_API_V4_URL                   // auto-set, defaults to https://gitlab.com/api/v4
`);
  process.exit(0);
}

run({ dryRun }).catch((err: Error) => {
  console.error(`\n❌  cdk-diff-report failed: ${err.message}\n`);
  process.exit(1);
});
