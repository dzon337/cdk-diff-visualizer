/**
 * CLI orchestrator — runs `cdk diff`, parses output, enriches with live pricing,
 * generates HTML/Markdown reports, and posts PR/MR comments.
 * @module runner
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config';
import { parseCdkDiff } from './parser';
import { generateHtml, generateMarkdownComment } from './report';
import { formatCostWithSign } from './cost-estimator';

export interface RunOptions { dryRun?: boolean; cwd?: string }

export async function run(options: RunOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const dryRun = options.dryRun ?? config.dryRun ?? false;

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
        prUrl = buildPrUrl(resolveBitbucketEnv({ workspace: config.workspace, repoSlug: config.repoSlug, apiUrl: config.bitbucketApiUrl }));
      }
    } catch (err) {
      console.warn(`\n⚠️  cdk-diff-report: ${(err as Error).message}`);
      console.warn('Skipping PR comment. Running cdk diff anyway.\n');
    }
  }

  const cdkArgs = ['diff', '--ci', ...config.cdkArgs];
  console.log(`\n▶  cdk ${cdkArgs.join(' ')}\n`);
  const rawOutput = await runCdkDiff(cdkArgs, cwd);

  const diff = parseCdkDiff(rawOutput);

  const allResources = diff.stacks.flatMap((s) => s.resources);
  if (allResources.length > 0) {
    try {
      const { enrichWithLivePricing, calculateCostImpact } = await import('./cost-estimator');
      const { liveCount } = await enrichWithLivePricing(allResources, cwd);
      for (const s of diff.stacks) s.costImpact = calculateCostImpact(s.resources);
      diff.costImpact = calculateCostImpact(allResources);
      if (liveCount > 0) console.log(`💰  Fetched live pricing for ${liveCount} resource(s) from AWS Pricing API`);
    } catch { /* static fallback applied */ }
  }

  const total = diff.totalAdded + diff.totalModified + diff.totalRemoved;
  if (total === 0 && !diff.hasSecurityChanges) {
    console.log('\n✅  No infrastructure changes detected.\n');
  } else {
    console.log(`\n📊  Summary: +${diff.totalAdded} added, ~${diff.totalModified} modified, -${diff.totalRemoved} removed`);
    if (diff.costImpact.netCost !== 0) {
      const src = diff.costImpact.liveResources > 0 ? ' (live pricing)' : ' (estimates)';
      console.log(`${diff.costImpact.netCost > 0 ? '📈' : '📉'}  Estimated cost impact: ${formatCostWithSign(diff.costImpact.netCost)}/mo${src}`);
    }
    if (diff.hasSecurityChanges) console.log('🔐  IAM / Security Group changes detected — review carefully!');
    console.log('');
  }

  const html = generateHtml(diff, prUrl, rawOutput);
  if (config.htmlOutput) {
    const out = path.resolve(cwd, config.htmlOutput);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, html, 'utf-8');
    console.log(`📄  HTML report written to: ${out}`);
  }

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
      const e = resolveGitHubEnv(); prUrl = buildGitHubPrUrl(e); await upsertGitHubPrComment(e, markdown);
    } else if (config.platform === 'gitlab') {
      const { resolveGitLabEnv, buildGitLabMrUrl, upsertMrNote } = await import('./gitlab');
      const e = resolveGitLabEnv({ apiUrl: config.gitlabApiUrl }); prUrl = buildGitLabMrUrl(e); await upsertMrNote(e, markdown);
    } else {
      const { resolveBitbucketEnv, buildPrUrl, upsertPrComment } = await import('./bitbucket');
      const e = resolveBitbucketEnv({ workspace: config.workspace, repoSlug: config.repoSlug, apiUrl: config.bitbucketApiUrl }); prUrl = buildPrUrl(e); await upsertPrComment(e, markdown);
    }
    console.log('done ✓');
    console.log(`🔗  ${prUrl}\n`);
  } catch (err) {
    console.error(`\n❌  Failed to post PR comment: ${(err as Error).message}`);
  }
}

function runCdkDiff(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const child = spawn('cdk', args, { cwd, env: process.env, shell: true, stdio: ['inherit', 'pipe', 'pipe'] });
    child.stdout.on('data', (c: Buffer) => { process.stdout.write(c); chunks.push(c); });
    child.stderr.on('data', (c: Buffer) => { process.stderr.write(c); });
    child.on('error', (e) => reject((e as NodeJS.ErrnoException).code === 'ENOENT' ? new Error('`cdk` not found. Install: npm i -g aws-cdk') : e));
    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw.trim()) console.warn('\n⚠️  cdk diff produced no stdout\n');
      code !== null && code > 1 ? reject(new Error(`cdk diff exited with code ${code}`)) : resolve(raw);
    });
  });
}