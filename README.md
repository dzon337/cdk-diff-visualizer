# cdk-diff-report

> Run `cdk diff` and get a beautifully formatted cost-aware summary posted to your Bitbucket, GitHub, or GitLab PR/MR — automatically.

![npm](https://img.shields.io/npm/v/cdk-diff-report)
![node](https://img.shields.io/node/v/cdk-diff-report)
![license](https://img.shields.io/npm/l/cdk-diff-report)

## What it does

1. Runs `cdk diff` and streams the raw output to your pipeline console
2. Parses the diff into a structured summary (added/modified/removed resources)
3. **Estimates monthly cost impact** for each resource (live AWS Pricing API + static fallback)
4. Posts a formatted Markdown comment to your PR/MR
5. On subsequent runs, **updates the same comment** instead of creating duplicates

## Quick Start

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `platform` | `string` | `"bitbucket"` | CI platform: `"bitbucket"`, `"github"`, or `"gitlab"` |
| `cdkArgs` | `string[]` | `["--all"]` | Arguments forwarded to `cdk diff` |
| `htmlOutput` | `string` | — | Path to write a standalone HTML report |
| `dryRun` | `boolean` | `false` | Skip posting, print markdown preview instead |
| `bitbucketApiUrl` | `string` | `https://api.bitbucket.org/2.0` | Override for Bitbucket Server |
| `gitlabApiUrl` | `string` | auto-detected | Override for self-managed GitLab |
| `workspace` | `string` | `$BITBUCKET_WORKSPACE` | Override Bitbucket workspace slug |
| `repoSlug` | `string` | `$BITBUCKET_REPO_SLUG` | Override Bitbucket repo slug |

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
