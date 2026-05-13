# cdk-diff-report

> Run `cdk diff` and get a beautifully formatted cost-aware summary posted to your Bitbucket, GitHub, or GitLab PR/MR — automatically.

[![GitHub Marketplace](https://img.shields.io/badge/Marketplace-CDK%20Diff%20Report-blue?logo=github)](https://github.com/marketplace/actions/cdk-diff-report)
![npm](https://img.shields.io/npm/v/cdk-diff-report)
![node](https://img.shields.io/node/v/cdk-diff-report)
![license](https://img.shields.io/npm/l/cdk-diff-report)

## What it does

1. Runs `cdk diff` and streams the raw output to your pipeline console
2. Parses the diff into a structured summary (added/modified/removed resources)
3. **Estimates monthly cost impact** for each resource (live AWS Pricing API + static fallback)
4. Posts a formatted Markdown comment to your PR/MR
5. On subsequent runs, **updates the same comment** instead of creating duplicates

### NPM Package available:
https://www.npmjs.com/package/cdk-diff-report

## Quick Start — GitHub Action (recommended)

The fastest way to get started on GitHub:

```yaml
# .github/workflows/cdk-diff.yml
name: CDK Diff
on: pull_request

jobs:
  cdk-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - run: npm ci                         # install your CDK app deps
      - uses: dzon337/cdk-diff-visualizer@v1
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: eu-central-1
```

That's it — every PR gets a cost-aware diff comment automatically.

### Action Inputs

| Input | Description | Default |
|-------|-------------|---------|
| `cdk-args` | Arguments forwarded to `cdk diff` (comma-separated) | `--all` |
| `html-output` | Path to write an HTML report | — |
| `dry-run` | Preview markdown without posting | `false` |
| `working-directory` | Directory containing `cdk.json` | `.` |
| `node-version` | Node.js version to use | `20` |

---

## Quick Start — npm CLI

### 1. Install

```bash
npm install -g cdk-diff-report
```

### 2. Create a config file

Create a `.cdkdiffreportrc` file **in the root of your CDK project** (next to `cdk.json`):

```json
{
  "platform": "github",
  "cdkArgs": ["--all"],
  "htmlOutput": "cdk-diff.html"
}
```

### 3. Run it

```bash
# In your CDK project directory (where cdk.json lives):
cdk-diff-report              # run diff + post PR comment
cdk-diff-report --dry-run    # run diff + print markdown preview (no posting)
cdk-diff-report --help       # show all options
```

---

## Configuration

### Where to put `.cdkdiffreportrc`

Place the file **in the root of the project where you run `cdk diff`** — the same
directory as your `cdk.json`. The tool looks for `.cdkdiffreportrc` or
`.cdkdiffreportrc.json` in the current working directory.

```
my-cdk-project/
├── cdk.json
├── .cdkdiffreportrc      ← put it here
├── lib/
│   └── my-stack.ts
├── bin/
│   └── app.ts
└── package.json
```

### All options

```jsonc
{
  // Required: which CI platform are you using?
  // Options: "bitbucket" | "github" | "gitlab"
  "platform": "github",

  // Arguments forwarded to `cdk diff`
  // Default: ["--all"]
  // Examples:
  //   ["--all"]                     → diff all stacks
  //   ["MyStack"]                   → diff only MyStack
  //   ["--all", "--no-change-set"]  → skip change set creation (faster)
  "cdkArgs": ["--all"],

  // Optional: write a standalone HTML report to this file path
  // Great for CI artifacts — gives you a visual dashboard
  "htmlOutput": "cdk-diff.html",

  // Optional: never post to PR, just preview in the terminal
  // Default: false
  "dryRun": false,

  // Bitbucket Server only — override the API base URL
  // Default: "https://api.bitbucket.org/2.0"
  "bitbucketApiUrl": "https://api.bitbucket.org/2.0",

  // Self-managed GitLab only — override the API URL
  // Default: auto-detected from $CI_API_V4_URL or "https://gitlab.com/api/v4"
  "gitlabApiUrl": "https://gitlab.mycompany.com/api/v4"
}
```

> **Note:** JSON does not support comments. The `//` comments above are for
> illustration only. Your actual `.cdkdiffreportrc` must be valid JSON without comments.

### Options reference

| Field | RC file key | Env var override | Default |
|-------|------------|------------------|---------|
| Platform | `platform` | `CDK_DIFF_PLATFORM` | `"bitbucket"` |
| CDK args | `cdkArgs` | `CDK_DIFF_CDK_ARGS` (comma-separated) | `["--all"]` |
| HTML report | `htmlOutput` | `CDK_DIFF_HTML_OUTPUT` | — |
| Dry run | `dryRun` | `CDK_DIFF_DRY_RUN` (`true`/`false`) | `false` |
| BB API URL | `bitbucketApiUrl` | `CDK_DIFF_BITBUCKET_API_URL` | `https://api.bitbucket.org/2.0` |
| GL API URL | `gitlabApiUrl` | `CDK_DIFF_GITLAB_API_URL` | auto-detected |
| BB workspace | `workspace` | `CDK_DIFF_WORKSPACE` | `$BITBUCKET_WORKSPACE` |
| BB repo slug | `repoSlug` | `CDK_DIFF_REPO_SLUG` | `$BITBUCKET_REPO_SLUG` |

**Priority:** `CDK_DIFF_*` env vars → `.cdkdiffreportrc` file → built-in defaults.

### Multi-repo / Cross-repo setup

If your **buildspec lives in a different repo** than your CDK app, you have two options:

#### Option A: Use `--cwd` to point to the CDK project

```yaml
# buildspec.yml (in your CI/CD repo)
phases:
  build:
    commands:
      - git clone https://bitbucket.org/my-team/my-cdk-app.git /tmp/cdk-app
      - cd /tmp/cdk-app && npm ci
      - cdk-diff-report --cwd /tmp/cdk-app
```

The tool reads `.cdkdiffreportrc` and runs `cdk diff` from the `--cwd` directory.

#### Option B: Use environment variables (no config file needed)

Set everything via `CDK_DIFF_*` env vars in your buildspec — no need to put a
`.cdkdiffreportrc` in the CDK repo at all:

```yaml
# buildspec.yml
env:
  variables:
    CDK_DIFF_PLATFORM: "bitbucket"
    CDK_DIFF_CDK_ARGS: "--all"
    CDK_DIFF_HTML_OUTPUT: "cdk-diff.html"
    BITBUCKET_WORKSPACE: "my-team"
    BITBUCKET_REPO_SLUG: "my-cdk-app"
  secrets-manager:
    BITBUCKET_ACCESS_TOKEN: "bitbucket/access-token"

phases:
  build:
    commands:
      - export BITBUCKET_PR_ID=$(echo $CODEBUILD_WEBHOOK_TRIGGER | grep -oP '\d+')
      - cd /path/to/cdk-app && npm ci
      - cdk-diff-report
```

---

## Cost Estimation

The tool estimates the monthly cost impact of your infrastructure changes using a
**three-tier strategy**:

1. **CloudFormation template analysis** — reads actual resource properties from `cdk.out/`
   (instance types, memory sizes, DB engines, etc.)
2. **AWS Pricing API** — queries real on-demand prices for EC2, RDS, ElastiCache,
   NAT Gateway, Lambda, and ECS Fargate
3. **Static fallback** — uses a built-in table of ~80 resource types when the API
   is unavailable

The cost column appears in both the PR comment and the HTML report:

```
| ✅ Added | `MyBucket`      | S3 › Bucket     | +$0.023/mo |
| ✅ Added | `MyFunction`    | Lambda › Func   | +$0.620/mo |
| ❌ Removed | `OldDb`       | RDS › DBInstance | -$49.64/mo |
```

> Cost estimates require AWS credentials (the same ones used for `cdk diff`).
> If credentials are unavailable, the tool falls back to static estimates silently.

---

## Platform Setup

### GitHub Actions

#### Using the Marketplace Action (recommended)

```yaml
# .github/workflows/cdk-diff.yml
name: CDK Diff
on: pull_request

jobs:
  cdk-diff:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - uses: dzon337/cdk-diff-visualizer@v1
        with:
          cdk-args: '--all'
          html-output: 'cdk-diff.html'
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
          AWS_DEFAULT_REGION: eu-central-1
```

#### Using npx directly

```yaml
steps:
  - uses: actions/checkout@v4
  - uses: actions/setup-node@v4
    with:
      node-version: '20'
  - run: npm ci
  - run: npx cdk-diff-report
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
      AWS_DEFAULT_REGION: eu-central-1
```

**Environment variables** (set automatically by GitHub Actions):

| Variable | Source |
|----------|--------|
| `GITHUB_TOKEN` | Auto-provided, needs `pull-requests: write` permission |
| `GITHUB_REF` | Auto-set, PR number extracted from `refs/pull/N/merge` |
| `GITHUB_REPOSITORY` | Auto-set (`owner/repo`) |

### GitLab CI/CD

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
    GITLAB_TOKEN: $CDK_DIFF_GITLAB_TOKEN
```

Add `CDK_DIFF_GITLAB_TOKEN` in **Settings → CI/CD → Variables** (masked, protected).

> **Important:** `CI_MERGE_REQUEST_IID` is only set in
> [merge request pipelines](https://docs.gitlab.com/ee/ci/pipelines/merge_request_pipelines.html).
> Make sure you use `rules: - if: $CI_PIPELINE_SOURCE == "merge_request_event"`.

| Variable | Source |
|----------|--------|
| `GITLAB_TOKEN` | **You create this** — project token with `api` scope |
| `CI_PROJECT_ID` | Auto-set |
| `CI_MERGE_REQUEST_IID` | Auto-set (MR pipelines only) |
| `CI_API_V4_URL` | Auto-set |

### Bitbucket Pipelines

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
```

Add `BITBUCKET_ACCESS_TOKEN` in **Repository settings → Repository variables**.

| Variable | Source |
|----------|--------|
| `BITBUCKET_ACCESS_TOKEN` | **You create this** — needs `pullrequest:write` scope |
| `BITBUCKET_PR_ID` | Auto-set |
| `BITBUCKET_WORKSPACE` | Auto-set |
| `BITBUCKET_REPO_SLUG` | Auto-set |

### AWS CodePipeline + CodeBuild → Bitbucket

When your CDK project uses **AWS CodePipeline** triggered by Bitbucket PRs,
CodeBuild doesn't set the Bitbucket env vars automatically. You need to provide
them yourself.

#### Step 1: Store the Bitbucket token in Secrets Manager

```bash
aws secretsmanager create-secret \
  --name bitbucket/access-token \
  --secret-string "YOUR_BITBUCKET_APP_PASSWORD_OR_TOKEN"
```

> Create a Bitbucket **App Password** at https://bitbucket.org/account/settings/app-passwords/
> with the `pullrequest:write` scope. Or use a repository access token.

#### Step 2: Configure your buildspec

When CodeBuild is triggered by a PR webhook, the env var `CODEBUILD_WEBHOOK_TRIGGER`
is set to `pr/123` (where 123 is the PR number). Extract it in your buildspec:

```yaml
# buildspec.yml
version: 0.2
env:
  secrets-manager:
    BITBUCKET_ACCESS_TOKEN: "bitbucket/access-token"
  variables:
    # Set these to match your Bitbucket repository
    BITBUCKET_WORKSPACE: "my-team"
    BITBUCKET_REPO_SLUG: "my-cdk-app"

phases:
  install:
    runtime-versions:
      nodejs: 20
    commands:
      - npm ci
      - npm install -g aws-cdk cdk-diff-report

  build:
    commands:
      # Extract PR ID from CodeBuild webhook trigger (format: "pr/123")
      - export BITBUCKET_PR_ID=$(echo $CODEBUILD_WEBHOOK_TRIGGER | grep -oP '\d+')
      - echo "PR ID = $BITBUCKET_PR_ID"

      # Run the diff + post comment to Bitbucket
      - cdk-diff-report

artifacts:
  files:
    - cdk-diff.html
  discard-paths: yes
```

#### Step 3: Set up CodeBuild

In your CodeBuild project:

1. **Source**: Connect to Bitbucket via CodeStar Connections
2. **Webhook**: Enable webhook events for `PULL_REQUEST_CREATED` and `PULL_REQUEST_UPDATED`
3. **IAM Role**: Grant the CodeBuild role permission to read from Secrets Manager:
   ```json
   {
     "Effect": "Allow",
     "Action": "secretsmanager:GetSecretValue",
     "Resource": "arn:aws:secretsmanager:*:*:secret:bitbucket/access-token-*"
   }
   ```
4. **Environment variables**: Set `BITBUCKET_WORKSPACE` and `BITBUCKET_REPO_SLUG`
   either in the buildspec (above) or in the CodeBuild project configuration.

#### How it works

```
Bitbucket PR created/updated
  → CodeBuild webhook trigger: CODEBUILD_WEBHOOK_TRIGGER=pr/123
    → buildspec extracts PR ID: BITBUCKET_PR_ID=123
      → cdk-diff-report runs cdk diff
        → posts formatted comment to Bitbucket PR #123
```

> **Tip:** If you're using CodePipeline (not direct CodeBuild webhook), the PR ID
> is not available via `CODEBUILD_WEBHOOK_TRIGGER`. In that case, pass it as a
> CodePipeline variable or use a Lambda step to resolve it from the source revision.

---

## PR/MR Comment Preview

The tool posts a collapsible Markdown comment with per-stack breakdown:

```
## 🚀 CDK Diff Report

> 📈 **Estimated monthly cost impact: +$1.04/mo**

| ✅ Added | ⚠️ Modified | ❌ Removed | 🔐 IAM stacks | 💰 Est. cost |
|---------|------------|-----------|--------------|-------------|
| 5       | 0          | 0         | 1            | +$1.04/mo   |

<details>
<summary><strong>MyStack</strong> — +5 · 🔐 IAM · 💰 +$1.04/mo</summary>

| Change    | Logical ID   | Type           | Est. Cost    |
|-----------|-------------|----------------|--------------|
| ✅ Added  | `MyBucket`  | S3 › Bucket    | +$0.023/mo   |
| ✅ Added  | `MyFunction`| Lambda › Func  | +$0.620/mo   |
| ✅ Added  | `MyQueue`   | SQS › Queue    | +$0.400/mo   |
</details>
```

On the next run, the **same comment is updated** with the latest diff.

---

## Use as a Library

```typescript
import { run, parseCdkDiff, generateMarkdownComment, enrichWithLivePricing } from 'cdk-diff-report';

// Full run (diff + comment)
await run({ dryRun: true });

// Just the parser
const diff = parseCdkDiff(rawCdkOutput);
console.log(diff.totalAdded, diff.costImpact.netCost);

// Platform-specific comment management
import { resolveGitHubEnv, upsertGitHubPrComment } from 'cdk-diff-report';
const env = resolveGitHubEnv();
await upsertGitHubPrComment(env, '## My Report\n...');
```

---

## FAQ

**Q: Where does `.cdkdiffreportrc` go?**
A: In the root of your CDK project — the same directory where `cdk.json` lives.

**Q: Do I need AWS credentials for cost estimation?**
A: The tool uses the same AWS credentials you already provide for `cdk diff`.
If credentials are missing, cost estimates fall back to static defaults.

**Q: What if I don't have a PR (e.g. push to main)?**
A: The tool runs `cdk diff` and prints the summary to the console, but skips
the PR comment gracefully — no crash.

**Q: Can I diff only specific stacks?**
A: Yes, set `"cdkArgs": ["MyStack", "OtherStack"]` in your config.

**Q: Does it support monorepos?**
A: Yes, run `cdk-diff-report` from the directory containing `cdk.json`.
Each CDK app needs its own `.cdkdiffreportrc`.

---

## License

MIT
