/**
 * Bitbucket Cloud API integration — list, post, update, delete, and upsert
 * PR comments with hidden-marker-based deduplication.
 * @module bitbucket
 */

export interface BitbucketEnv { prId: string; workspace: string; repoSlug: string; accessToken: string; apiUrl: string }

export function resolveBitbucketEnv(overrides: Partial<BitbucketEnv> = {}): BitbucketEnv {
  const prId = overrides.prId ?? process.env['BITBUCKET_PR_ID'] ?? '';
  const workspace = overrides.workspace ?? process.env['BITBUCKET_WORKSPACE'] ?? '';
  const repoSlug = overrides.repoSlug ?? process.env['BITBUCKET_REPO_SLUG'] ?? '';
  const accessToken = process.env['BITBUCKET_ACCESS_TOKEN'] ?? '';
  const apiUrl = overrides.apiUrl ?? 'https://api.bitbucket.org/2.0';
  const missing = [!prId && 'BITBUCKET_PR_ID', !workspace && 'BITBUCKET_WORKSPACE', !repoSlug && 'BITBUCKET_REPO_SLUG', !accessToken && 'BITBUCKET_ACCESS_TOKEN'].filter(Boolean);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}\nSet automatically by Bitbucket Pipelines, or use --dry-run.`);
  return { prId, workspace, repoSlug, accessToken, apiUrl };
}

export function buildPrUrl(env: BitbucketEnv): string {
  return `https://bitbucket.org/${env.workspace}/${env.repoSlug}/pull-requests/${env.prId}`;
}

const COMMENT_MARKER = '<!-- cdk-diff-report -->';
export function withMarker(md: string): string { return `${COMMENT_MARKER}\n${md}`; }

interface BBComment { id: number; content: { raw: string } }
interface BBPage<T> { values: T[]; next?: string }

function headers(env: BitbucketEnv): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${env.accessToken}` };
}
function baseUrl(env: BitbucketEnv): string {
  return `${env.apiUrl}/repositories/${env.workspace}/${env.repoSlug}/pullrequests/${env.prId}/comments`;
}

export async function listPrComments(env: BitbucketEnv): Promise<BBComment[]> {
  const all: BBComment[] = [];
  let url: string | undefined = baseUrl(env);
  while (url) {
    const r = await fetch(url, { method: 'GET', headers: headers(env) });
    if (!r.ok) throw new Error(`Bitbucket API ${r.status}: ${await r.text()}`);
    const d = (await r.json()) as BBPage<BBComment>;
    all.push(...d.values);
    url = d.next;
  }
  return all;
}

export async function findExistingComment(env: BitbucketEnv): Promise<number | null> {
  const c = (await listPrComments(env)).find((c) => c.content?.raw?.includes(COMMENT_MARKER));
  return c ? c.id : null;
}

export async function postPrComment(env: BitbucketEnv, md: string): Promise<void> {
  const r = await fetch(baseUrl(env), { method: 'POST', headers: headers(env), body: JSON.stringify({ content: { raw: md } }) });
  if (!r.ok) throw new Error(`Bitbucket API ${r.status}: ${await r.text()}`);
}

export async function updatePrComment(env: BitbucketEnv, id: number, md: string): Promise<void> {
  const r = await fetch(`${baseUrl(env)}/${id}`, { method: 'PUT', headers: headers(env), body: JSON.stringify({ content: { raw: md } }) });
  if (!r.ok) throw new Error(`Bitbucket API ${r.status}: ${await r.text()}`);
}

export async function deletePrComment(env: BitbucketEnv, id: number): Promise<void> {
  const r = await fetch(`${baseUrl(env)}/${id}`, { method: 'DELETE', headers: headers(env) });
  if (!r.ok) throw new Error(`Bitbucket API ${r.status}: ${await r.text()}`);
}

export async function upsertPrComment(env: BitbucketEnv, md: string): Promise<void> {
  const marked = withMarker(md);
  const existing = await findExistingComment(env);
  existing !== null ? await updatePrComment(env, existing, marked) : await postPrComment(env, marked);
}
