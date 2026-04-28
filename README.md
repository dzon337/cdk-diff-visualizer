# cdk-diff-report

Run `cdk diff`, stream the output live to your pipeline console, and automatically post a formatted summary comment to your **Bitbucket**, **GitHub**, or **GitLab** pull/merge request.

On repeated pipeline runs the **existing comment is updated in-place** (upsert) instead of creating duplicates.

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
4. Parses the diff and posts a formatted Markdown summary as a PR/MR comment
5. On subsequent runs, **updates** the existing comment instead of creating a new one
6. Prints the PR/MR link to the console

```bash
cdk-diff-report --dry-run   # runs diff, prints markdown preview, skips posting
cdk-diff-report --help
```

## Configuration

Create a `.cdkdiffreportrc` file in your project root:

```json
{
  "platform": "bitbucket",
  "cdkArgs": ["--all"],
  "htmlOutput": "cdk-diff.html",
  "dryRun": false
}
```

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `platform` | `string` | `"bitbucket"` | CI platform: `"bitbucket"`, `"github"`, or `"gitlab"` |
| `cdkArgs` | `string[]` | `["--all"]` | Args forwarded verbatim to `cdk diff` |
| `htmlOutput` | `string` | — | Write a standalone HTML report to this path |
| `dryRun` | `boolean` | `false` | Skip posting, print markdown preview instead |
| `bitbucketApiUrl` | `string` | `https://api.bitbucket.org/2.0` | Override for Bitbucket Server |
| `gitlabApiUrl` | `string` | `$CI_API_V4_URL` or `https://gitlab.com/api/v4` | Override for self-managed GitLab |
| `workspace` | `string` | `$BITBUCKET_WORKSPACE` | Override workspace slug (Bitbucket) |
| `repoSlug` | `string` | `$BITBUCKET_REPO_SLUG` | Override repo slug (Bitbucket) |

## Bitbucket

### Environment Variables

These are set automatically by Bitbucket Pipelines:

| Variable | Description |
|----------|-------------|
| `BITBUCKET_PR_ID` | PR number (only set on PR builds) |
| `BITBUCKET_WORKSPACE` | Workspace slug |
| `BITBUCKET_REPO_SLUG` | Repository slug |
| `BITBUCKET_ACCESS_TOKEN` | **You must create this.** Repository → Settings → Access tokens. Needs `pullrequest:write` scope. |

> If `BITBUCKET_PR_ID` is not set (e.g. a push to main), the tool runs `cdk diff` and prints the summary but skips the PR comment gracefully — no crash.

### Bitbucket Pipelines setup

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

## GitHub

### Environment Variables

These are set automatically by GitHub Actions:

| Variable | Description |
|----------|-------------|
| `GITHUB_REF` | Git ref (PR number extracted from `refs/pull/N/merge`) |
| `GITHUB_PR_NUMBER` | Alternative: set the PR number directly |
| `GITHUB_REPOSITORY` | `owner/repo` |
| `GITHUB_REPOSITORY_OWNER` | Repository owner |
| `GITHUB_TOKEN` | Automatically provided by GitHub Actions (needs `pull-requests: write`) |

### GitHub Actions setup

```yaml
# .github/workflows/cdk-diff.yml
name: CDK Diff
on:
  pull_request:

jobs:
  cdk-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - run: npx cdk-diff-report
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## GitLab

### Environment Variables

These are set automatically by GitLab CI/CD when using **merge request pipelines**:

| Variable | Description |
|----------|-------------|
| `CI_PROJECT_ID` | Numeric project ID |
| `CI_MERGE_REQUEST_IID` | Merge request IID (only set for MR pipelines) |
| `GITLAB_TOKEN` | **You must create this.** Project or personal access token with `api` scope. |
| `CI_JOB_TOKEN` | Fallback — auto-provided, but has limited permissions. Prefer `GITLAB_TOKEN`. |
| `CI_API_V4_URL` | Auto-set to `https://gitlab.com/api/v4` (or your self-managed instance URL) |

> **Important:** `CI_MERGE_REQUEST_IID` is only available in [merge request pipelines](https://docs.gitlab.com/ee/ci/pipelines/merge_request_pipelines.html). Make sure your `.gitlab-ci.yml` uses `rules` or `only: - merge_requests`.

### GitLab CI/CD setup

```yaml
# .gitlab-ci.yml
cdk-diff:
  image: node:20
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - npm ci
    - npx cdk-diff-report
  variables:
    GITLAB_TOKEN: $CDK_DIFF_GITLAB_TOKEN   # set in CI/CD Settings → Variables
```

Add `CDK_DIFF_GITLAB_TOKEN` as a **CI/CD variable** in GitLab → Settings → CI/CD → Variables (masked, protected recommended).

#### Self-managed GitLab

For self-managed instances, `CI_API_V4_URL` is automatically set to the correct API URL. Alternatively, override it in `.cdkdiffreportrc`:

```json
{
  "platform": "gitlab",
  "gitlabApiUrl": "https://gitlab.mycompany.com/api/v4"
}
```

## AWS CodePipeline / CodeBuild

```yaml
# buildspec.yml
phases:
  build:
    commands:
      - npm ci
      - npx cdk-diff-report
```

Set the appropriate token (`BITBUCKET_ACCESS_TOKEN`, `GITHUB_TOKEN`, or `GITLAB_TOKEN`) as a CodeBuild environment variable (from Secrets Manager recommended).

## PR/MR Comment example

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

On the next pipeline run, the **same comment is updated** with the latest diff instead of creating a new one.

## Use as a library

```typescript
import { run, parseCdkDiff, generateMarkdownComment } from 'cdk-diff-report';

// Full run (diff + comment)
await run({ dryRun: true });

// Or just the parser
const diff = parseCdkDiff(rawCdkOutput);
console.log(diff.totalAdded, diff.stacks);
```

### Bitbucket comment management

```typescript
import {
  resolveBitbucketEnv,
  upsertPrComment,
  listPrComments,
  deletePrComment,
} from 'cdk-diff-report';

const env = resolveBitbucketEnv();

// Upsert — creates or updates the cdk-diff-report comment
await upsertPrComment(env, '## My Report\n...');

// List all comments
const comments = await listPrComments(env);

// Delete a specific comment
await deletePrComment(env, commentId);
```

### GitHub comment management

```typescript
import {
  resolveGitHubEnv,
  upsertGitHubPrComment,
  listGitHubPrComments,
} from 'cdk-diff-report';

const env = resolveGitHubEnv();
await upsertGitHubPrComment(env, '## My Report\n...');
```

### GitLab comment management

```typescript
import {
  resolveGitLabEnv,
  upsertMrNote,
  listMrNotes,
  deleteMrNote,
} from 'cdk-diff-report';

const env = resolveGitLabEnv();

// Upsert — creates or updates the cdk-diff-report MR note
await upsertMrNote(env, '## My Report\n...');

// List all MR notes
const notes = await listMrNotes(env);

// Delete a specific note
await deleteMrNote(env, noteId);
```
