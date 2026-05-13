/**
 * GitHub API integration — list, post, update, and upsert PR comments
 * with hidden-marker-based deduplication.
 * @module github
 */

export interface GitHubEnv { prNumber: string; owner: string; repo: string; token: string; apiUrl: string }

export function resolveGitHubEnv(): GitHubEnv {
  const prNumber = extractPrFromRef(process.env['GITHUB_REF'] ?? '') || process.env['GITHUB_PR_NUMBER'] || '';
  const owner = process.env['GITHUB_REPOSITORY_OWNER'] ?? '';
  const repo = (process.env['GITHUB_REPOSITORY'] ?? '').split('/')[1] ?? '';
  const token = process.env['GITHUB_TOKEN'] ?? '';
  const apiUrl = process.env['GITHUB_API_URL'] ?? 'https://api.github.com';
  const missing = [!prNumber && 'GITHUB_PR_NUMBER', !owner && 'GITHUB_REPOSITORY_OWNER', !repo && 'GITHUB_REPOSITORY', !token && 'GITHUB_TOKEN'].filter(Boolean);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}\nSet automatically by GitHub Actions.`);
  return { prNumber, owner, repo, token, apiUrl };
}

export function buildGitHubPrUrl(env: GitHubEnv): string {
  return `https://github.com/${env.owner}/${env.repo}/pull/${env.prNumber}`;
}

const COMMENT_MARKER = '<!-- cdk-diff-report -->';
export function withMarker(md: string): string { return `${COMMENT_MARKER}\n${md}`; }

interface GHComment { id: number; body: string }

function headers(env: GitHubEnv): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${env.token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
}
function baseUrl(env: GitHubEnv): string {
  return `${env.apiUrl}/repos/${env.owner}/${env.repo}/issues/${env.prNumber}/comments`;
}

export async function listPrComments(env: GitHubEnv): Promise<GHComment[]> {
  const all: GHComment[] = [];
  let url: string | undefined = `${baseUrl(env)}?per_page=100`;
  while (url) {
    const r = await fetch(url, { method: 'GET', headers: headers(env) });
    if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
    all.push(...(await r.json()) as GHComment[]);
    const link = r.headers.get('link') ?? '';
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : undefined;
  }
  return all;
}

export async function findExistingComment(env: GitHubEnv): Promise<number | null> {
  const c = (await listPrComments(env)).find((c) => c.body?.includes(COMMENT_MARKER));
  return c ? c.id : null;
}

export async function postGitHubPrComment(env: GitHubEnv, md: string): Promise<void> {
  const r = await fetch(baseUrl(env), { method: 'POST', headers: headers(env), body: JSON.stringify({ body: md }) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
}

export async function updateGitHubPrComment(env: GitHubEnv, id: number, md: string): Promise<void> {
  const r = await fetch(`${env.apiUrl}/repos/${env.owner}/${env.repo}/issues/comments/${id}`, { method: 'PATCH', headers: headers(env), body: JSON.stringify({ body: md }) });
  if (!r.ok) throw new Error(`GitHub API ${r.status}: ${await r.text()}`);
}

export async function upsertGitHubPrComment(env: GitHubEnv, md: string): Promise<void> {
  const marked = withMarker(md);
  const existing = await findExistingComment(env);
  existing !== null ? await updateGitHubPrComment(env, existing, marked) : await postGitHubPrComment(env, marked);
}

function extractPrFromRef(ref: string): string { return ref.match(/refs\/pull\/(\d+)\//)?.[1] ?? ''; }