#!/usr/bin/env node
import { run } from './runner';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dry');

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
cdk-diff-report — Run cdk diff and post a cost-aware summary to your PR/MR.

Usage:
  cdk-diff-report              Run diff and post/update PR comment
  cdk-diff-report --dry-run    Run diff, print markdown preview, skip posting
  cdk-diff-report --help       Show this help

Configuration:
  Create a .cdkdiffreportrc file in your CDK project root (next to cdk.json):

  {
    "platform": "github",          "bitbucket" | "github" | "gitlab"
    "cdkArgs": ["--all"],          args forwarded to cdk diff
    "htmlOutput": "cdk-diff.html", write HTML report to this path
    "dryRun": false                skip posting, just preview
  }

Environment variables (platform-specific):

  GitHub:    GITHUB_TOKEN (auto-provided by Actions, needs pull-requests: write)
  GitLab:    GITLAB_TOKEN (project token with api scope, add as CI/CD variable)
  Bitbucket: BITBUCKET_ACCESS_TOKEN (repo token with pullrequest:write)

  AWS (for cdk diff + live cost pricing):
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION

Docs: https://github.com/dzon337/cdk-diff-visualizer#readme
`);
  process.exit(0);
}

run({ dryRun }).catch((err: Error) => {
  console.error(`\n❌  cdk-diff-report failed: ${err.message}\n`);
  process.exit(1);
});
