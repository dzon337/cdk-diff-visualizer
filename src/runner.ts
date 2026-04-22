import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { loadConfig } from './config';
import { parseCdkDiff } from './parser';
import { generateHtml, generateMarkdownComment } from './report';
import { resolveBitbucketEnv, buildPrUrl, postPrComment } from './bitbucket';

export interface RunOptions {
  dryRun?: boolean;
  cwd?: string;
}

export async function run(options: RunOptions = {}): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const config = loadConfig(cwd);
  const dryRun = options.dryRun ?? config.dryRun ?? false;

  // ─── 1. Resolve Bitbucket env early so we fail fast before running cdk diff ───
  let bbEnv: ReturnType<typeof resolveBitbucketEnv> | null = null;
  if (!dryRun) {
    try {
      bbEnv = resolveBitbucketEnv({
        workspace: config.workspace,
        repoSlug: config.repoSlug,
        apiUrl: config.bitbucketApiUrl,
      });
    } catch (err) {
      // If not in a PR context (e.g. main branch push), skip commenting gracefully
      console.warn(`\n⚠️  cdk-diff-report: ${(err as Error).message}`);
      console.warn('Skipping PR comment. Running cdk diff anyway.\n');
    }
  }

  const prUrl = bbEnv ? buildPrUrl(bbEnv) : undefined;

  // ─── 2. Run cdk diff, stream stdout live, collect for parsing ───────────────
  const cdkArgs = ['diff', ...config.cdkArgs];
  console.log(`\n▶  cdk ${cdkArgs.join(' ')}\n`);

  const rawOutput = await runCdkDiff(cdkArgs, cwd);

  // ─── 3. Parse ────────────────────────────────────────────────────────────────
  const diff = parseCdkDiff(rawOutput);

  const totalChanges = diff.totalAdded + diff.totalModified + diff.totalRemoved;
  if (totalChanges === 0 && !diff.hasSecurityChanges) {
    console.log('\n✅  No infrastructure changes detected.\n');
  } else {
    console.log(`\n📊  Summary: +${diff.totalAdded} added, ~${diff.totalModified} modified, -${diff.totalRemoved} removed`);
    if (diff.hasSecurityChanges) {
      console.log('🔐  IAM / Security Group changes detected — review carefully!');
    }
    console.log('');
  }

  // ─── 4. Generate HTML report (optional file output) ──────────────────────────
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
    const markdown = generateMarkdownComment(diff, prUrl);
    console.log(markdown);
    return;
  }

  if (!bbEnv) return; // No PR context, nothing to post

  const markdown = generateMarkdownComment(diff, prUrl);

  process.stdout.write('💬  Posting PR comment to Bitbucket... ');
  await postPrComment(bbEnv, markdown);
  console.log('done ✓');
  console.log(`🔗  ${prUrl}\n`);
}

// On Windows, globally installed npm binaries are .cmd wrappers — spawn('cdk') fails with ENOENT.
const CDK_CMD = process.platform === 'win32' ? 'cdk.cmd' : 'cdk';

function runCdkDiff(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    const child = spawn(CDK_CMD, args, {
      cwd,
      env: process.env,
      shell: process.platform === 'win32', // .cmd files need shell:true as a fallback
      stdio: ['inherit', 'pipe', 'inherit'],
    });

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
      chunks.push(chunk);
    });

    child.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error('`cdk` command not found. Make sure aws-cdk is installed: npm i -g aws-cdk'));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      // cdk diff exits with code 1 when there are changes — that's normal
      if (code !== null && code > 1) {
        reject(new Error(`cdk diff exited with code ${code}`));
      } else {
        resolve(raw);
      }
    });
  });
}
