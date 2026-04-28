import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config';
import { parseCdkDiff } from './parser';
import { generateHtml, generateMarkdownComment } from './report';
import { formatCostWithSign } from './cost-estimator';

export interface RunOptions {
  dryRun?: boolean;
  cwd?: string;
}

export async function run(options: RunOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const dryRun = options.dryRun ?? config.dryRun ?? false;

  // ─── 1. Resolve prUrl early for HTML report header ───────────────────────────
  let prUrl: string | undefined;
  if (!dryRun) {
    try {
      if (config.platform === 'github') {
        const { resolveGitHubEnv, buildGitHubPrUrl } = await import('./github');
        prUrl = buildGitHubPrUrl(resolveGitHubEnv());
      } else if (config.platform === 'gitlab') {
        const { resolveGitLabEnv, buildGitLabMrUrl } = await import('./gitlab');
        prUrl = buildGitLabMrUrl(resolveGitLabEnv({ apiUrl: config.gitlabApiUrl }));
      } else {
        const { resolveBitbucketEnv, buildPrUrl } = await import('./bitbucket');
        prUrl = buildPrUrl(resolveBitbucketEnv({
          workspace: config.workspace,
          repoSlug: config.repoSlug,
          apiUrl: config.bitbucketApiUrl,
        }));
      }
    } catch (err) {
      console.warn(`\n⚠️  cdk-diff-report: ${(err as Error).message}`);
      console.warn('Skipping PR comment. Running cdk diff anyway.\n');
    }
  }

  // ─── 2. Run cdk diff, stream to terminal, collect stdout for parsing ─────────
  const cdkArgs = ['diff', '--ci', ...config.cdkArgs];
  console.log(`\n▶  cdk ${cdkArgs.join(' ')}\n`);

  const rawOutput = await runCdkDiff(cdkArgs, cwd);

  // ─── 3. Parse ────────────────────────────────────────────────────────────────
  const diff = parseCdkDiff(rawOutput);

  // ─── 3b. Enrich with live AWS pricing ─────────────────────────────────────────
  const allResources = diff.stacks.flatMap((s) => s.resources);
  if (allResources.length > 0) {
    try {
      const { enrichWithLivePricing, calculateCostImpact } = await import('./cost-estimator');
      const { liveCount } = await enrichWithLivePricing(allResources, cwd);
      // Recalculate cost impact after enrichment
      for (const stack of diff.stacks) {
        stack.costImpact = calculateCostImpact(stack.resources);
      }
      diff.costImpact = calculateCostImpact(allResources);
      if (liveCount > 0) {
        console.log(`💰  Fetched live pricing for ${liveCount} resource(s) from AWS Pricing API`);
      }
    } catch {
      // AWS Pricing API unavailable — static fallback already applied
    }
  }

  const totalChanges = diff.totalAdded + diff.totalModified + diff.totalRemoved;
  if (totalChanges === 0 && !diff.hasSecurityChanges) {
    console.log('\n✅  No infrastructure changes detected.\n');
  } else {
    console.log(`\n📊  Summary: +${diff.totalAdded} added, ~${diff.totalModified} modified, -${diff.totalRemoved} removed`);
    if (diff.costImpact.netCost !== 0) {
      const emoji = diff.costImpact.netCost > 0 ? '📈' : '📉';
      const source = diff.costImpact.liveResources > 0 ? ' (live pricing)' : ' (estimates)';
      console.log(`${emoji}  Estimated cost impact: ${formatCostWithSign(diff.costImpact.netCost)}/mo${source}`);
    }
    if (diff.hasSecurityChanges) {
      console.log('🔐  IAM / Security Group changes detected — review carefully!');
    }
    console.log('');
  }

  // ─── 4. Generate HTML report ─────────────────────────────────────────────────
  const html = generateHtml(diff, prUrl, rawOutput);
  if (config.htmlOutput) {
    const outPath = path.resolve(cwd, config.htmlOutput);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html, 'utf-8');
    console.log(`📄  HTML report written to: ${outPath}`);
  }

  // ─── 5. Post PR comment ──────────────────────────────────────────────────────
  if (dryRun) {
    console.log('🔍  Dry run — skipping PR comment. Markdown preview:\n');
    console.log(generateMarkdownComment(diff, prUrl));
    return;
  }

  const markdown = generateMarkdownComment(diff, prUrl);

  process.stdout.write('💬  Posting PR comment... ');
  try {
    if (config.platform === 'github') {
      const { resolveGitHubEnv, buildGitHubPrUrl, upsertGitHubPrComment } = await import('./github');
      const ghEnv = resolveGitHubEnv();
      prUrl = buildGitHubPrUrl(ghEnv);
      await upsertGitHubPrComment(ghEnv, markdown);
    } else if (config.platform === 'gitlab') {
      const { resolveGitLabEnv, buildGitLabMrUrl, upsertMrNote } = await import('./gitlab');
      const glEnv = resolveGitLabEnv({ apiUrl: config.gitlabApiUrl });
      prUrl = buildGitLabMrUrl(glEnv);
      await upsertMrNote(glEnv, markdown);
    } else {
      const { resolveBitbucketEnv, buildPrUrl, upsertPrComment } = await import('./bitbucket');
      const bbEnv = resolveBitbucketEnv({
        workspace: config.workspace,
        repoSlug: config.repoSlug,
        apiUrl: config.bitbucketApiUrl,
      });
      prUrl = buildPrUrl(bbEnv);
      await upsertPrComment(bbEnv, markdown);
    }
    console.log('done ✓');
    console.log(`🔗  ${prUrl}\n`);
  } catch (err) {
    console.error(`\n❌  Failed to post PR comment: ${(err as Error).message}`);
  }
}

function runCdkDiff(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const stdoutChunks: Buffer[] = [];

    const child = spawn('cdk', args, {
      cwd,
      env: process.env,
      shell: true,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      stdoutChunks.push(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('`cdk` command not found. Make sure aws-cdk is installed: npm i -g aws-cdk'));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      const raw = Buffer.concat(stdoutChunks).toString('utf-8');
      if (!raw.trim()) {
        console.warn('\n⚠️  cdk diff produced no stdout — try adding "--ci" to cdkArgs in .cdkdiffreportrc\n');
      }
      // cdk diff exits with code 1 when changes exist — that's normal
      if (code !== null && code > 1) {
        reject(new Error(`cdk diff exited with code ${code}`));
      } else {
        resolve(raw);
      }
    });
  });
}