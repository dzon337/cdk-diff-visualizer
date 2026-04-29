#!/usr/bin/env node
import { run } from './runner';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || args.includes('--dry');
const cwdIdx = args.indexOf('--cwd');
const cwd = cwdIdx !== -1 && args[cwdIdx + 1] ? args[cwdIdx + 1] : undefined;

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
cdk-diff-report — Run cdk diff and post a cost-aware summary to your PR/MR.

Usage:
  cdk-diff-report                      Run diff and post/update PR comment
  cdk-diff-report --dry-run            Preview markdown, skip posting
  cdk-diff-report --cwd /path/to/cdk   Run in a different CDK project directory
  cdk-diff-report --help               Show this help

Configuration (in order of priority):
  1. CDK_DIFF_* environment variables   (highest — great for CI/CD)
  2. .cdkdiffreportrc file              (in the CDK project root, next to cdk.json)
  3. Built-in defaults                  (lowest)

  RC file example:
  {
    "platform": "github",
    "cdkArgs": ["--all"],
    "htmlOutput": "cdk-diff.html",
    "dryRun": false
  }

  Environment variable overrides:
    CDK_DIFF_PLATFORM=github           "bitbucket" | "github" | "gitlab"
    CDK_DIFF_CDK_ARGS=--all,MyStack    comma-separated args for cdk diff
    CDK_DIFF_HTML_OUTPUT=report.html   write HTML report
    CDK_DIFF_DRY_RUN=true              skip posting

  Platform tokens:
    GitHub:    GITHUB_TOKEN
    GitLab:    GITLAB_TOKEN
    Bitbucket: BITBUCKET_ACCESS_TOKEN, BITBUCKET_PR_ID, BITBUCKET_WORKSPACE, BITBUCKET_REPO_SLUG

  AWS (for cdk diff + live cost pricing):
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_DEFAULT_REGION

Docs: https://github.com/dzon337/cdk-diff-visualizer#readme
`);
  process.exit(0);
}

run({ dryRun, cwd }).catch((err: Error) => {
  console.error(`\n❌  cdk-diff-report failed: ${err.message}\n`);
  process.exit(1);
});
