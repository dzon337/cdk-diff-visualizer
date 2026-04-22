# cdk-diff-report

Run `cdk diff`, stream the output live to your pipeline console, and automatically post a formatted summary comment to your Bitbucket pull request.

## Install

```bash
npm install -g cdk-diff-report
# or as a dev dependency
npm install --save-dev cdk-diff-report
```

## Usage

```bash
cdk-diff-report
```

That's it. The tool:
1. Reads your `.cdkdiffreportrc` config
2. Runs `cdk diff` with your configured args
3. Streams raw output to the console (visible in pipeline logs)
4. Parses the diff and posts a formatted Markdown summary as a Bitbucket PR comment
5. Prints the PR link to the console

```bash
cdk-diff-report --dry-run   # runs diff, prints markdown preview, skips posting
cdk-diff-report --help
```

## Configuration

Create a `.cdkdiffreportrc` file in your project root:

```json
{
  "cdkArgs": ["--all"],
  "htmlOutput": "cdk-diff.html",
  "dryRun": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `cdkArgs` | `string[]` | `["--all"]` | Args forwarded verbatim to `cdk diff` |
| `htmlOutput` | `string` | — | Write a standalone HTML report to this path |
| `dryRun` | `boolean` | `false` | Skip posting, print markdown preview instead |
| `bitbucketApiUrl` | `string` | `https://api.bitbucket.org/2.0` | Override for Bitbucket Server |
| `workspace` | `string` | `$BITBUCKET_WORKSPACE` | Override workspace slug |
| `repoSlug` | `string` | `$BITBUCKET_REPO_SLUG` | Override repo slug |

## Environment Variables

These are set automatically by Bitbucket Pipelines:

| Variable | Description |
|----------|-------------|
| `BITBUCKET_PR_ID` | PR number (only set on PR builds) |
| `BITBUCKET_WORKSPACE` | Workspace slug |
| `BITBUCKET_REPO_SLUG` | Repository slug |
| `BITBUCKET_ACCESS_TOKEN` | **You must create this.** Repository → Settings → Access tokens. Needs `pullrequest:write` scope. |

> If `BITBUCKET_PR_ID` is not set (e.g. a push to main), the tool runs `cdk diff` and prints the summary but skips the PR comment gracefully — no crash.

## Bitbucket Pipelines setup

```yaml
# bitbucket-pipelines.yml
pipelines:
  pull-requests:
    '**':
      - step:
          name: CDK Diff
          script:
            - npm ci
            - npx cdk-diff-report
          after-script:
            # always runs, even if diff finds changes (exit code 1)
            - echo "Done"
```

Add `BITBUCKET_ACCESS_TOKEN` as a **Repository variable** in Bitbucket → Repository settings → Repository variables.

## AWS CodePipeline / CodeBuild

```yaml
# buildspec.yml
phases:
  build:
    commands:
      - npm ci
      - npx cdk-diff-report
```

Set `BITBUCKET_ACCESS_TOKEN` as a CodeBuild environment variable (from Secrets Manager recommended).

## PR Comment example

The tool posts a collapsible Markdown comment per stack:

```
## 🚀 CDK Diff Report

| ✅ Added | ⚠️ Modified | ❌ Removed | 🔐 IAM stacks |
|---------|------------|-----------|--------------|
| 3       | 2          | 1         | 1            |

<details>
<summary><strong>EcsResources</strong> — +3 · ~1 · 🔐 IAM</summary>
...
</details>
```

## Use as a library

```typescript
import { run, parseCdkDiff, generateMarkdownComment } from 'cdk-diff-report';

// Full run (diff + comment)
await run({ dryRun: true });

// Or just the parser
const diff = parseCdkDiff(rawCdkOutput);
console.log(diff.totalAdded, diff.stacks);
```
