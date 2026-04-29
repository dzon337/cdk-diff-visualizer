/**
 * Bitbucket Cloud + Server API integration — list, post, update, delete, and
 * upsert PR comments with hidden-marker-based deduplication.
 * Auto-detects Cloud vs Server based on the API URL.
 * @module bitbucket
 */

export interface BitbucketEnv { prId: string; workspace: string; repoSlug: string; accessToken: string; apiUrl: string }

function isServer(env: BitbucketEnv): boolean {
  return env.apiUrl.includes('/rest/api/');
}

export function resolveBitbucketEnv(overrides: Partial<BitbucketEnv> = {}): BitbucketEnv {
  const prId = overrides.prId ?? process.env['BITBUCKET_PR_ID'] ?? '';
  const workspace = overrides.workspace ?? process.env['BITBUCKET_WORKSPACE'] ?? '';
  const repoSlug = overrides.repoSlug ?? process.env['BITBUCKET_REPO_SLUG'] ?? '';
  const accessToken = process.env['BITBUCKET_ACCESS_TOKEN'] ?? '';
  const apiUrl = overrides.apiUrl ?? process.env['BITBUCKET_API_URL'] ?? 'https://api.bitbucket.org/2.0';
  const missing = [!prId && 'BITBUCKET_PR_ID', !workspace && 'BITBUCKET_WORKSPACE', !repoSlug && 'BITBUCKET_REPO_SLUG', !accessToken && 'BITBUCKET_ACCESS_TOKEN'].filter(Boolean);
  if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}\nSet automatically by Bitbucket Pipelines, or use --dry-run.`);
  return { prId, workspace, repoSlug, accessToken, apiUrl };
}

export function buildPrUrl(env: BitbucketEnv): string {
  if (isServer(env)) {
    const base = env.apiUrl.replace(/\/rest\/api\/[\d.]+\/?$/, '');
    return `${base}/projects/${env.workspace}/repos/${env.repoSlug}/pull-requests/${env.prId}`;
  }
  return `https://bitbucket.org/${env.workspace}/${env.repoSlug}/pull-requests/${env.prId}`;
}

const COMMENT_MARKER = '<!-- cdk-diff-report -->';
export function withMarker(md: string): string { return `${COMMENT_MARKER}\n${md}`; }

interface BBComment { id: number; text?: string; content?: { raw: string } }
interface BBCloudPage<T> { values: T[]; next?: string }
interface BBServerPage<T> { values: T[]; isLastPage: boolean; nextPageStart?: number }

function headers(env: BitbucketEnv): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${env.accessToken}` };
}

function commentsUrl(env: BitbucketEnv): string {
  if (isServer(env)) {
    return `${env.apiUrl}/projects/${env.workspace}/repos/${env.repoSlug}/pull-requests/${env.prId}/comments`;
  }
  return `${env.apiUrl}/repositories/${env.workspace}/${env.repoSlug}/pullrequests/${env.prId}/comments`;
}

function getCommentBody(c: BBComment): string {
  return c.text ?? c.content?.raw ?? '';
}

export async function listPrComments(env: BitbucketEnv): Promise<BBComment[]> {
  const all: BBComment[] = [];

  if (isServer(env)) {
    let start = 0;
    let done = false;
    while (!done) {
      const r = await fetch(`${commentsUrl(env)}?start=${start}&limit=100`, { method: 'GET', headers: headers(env) });
      if (!r.ok) throw new Error(`Bitbucket Server API ${r.status}: ${await r.text()}`);
      const d = (await r.json()) as BBServerPage<BBComment>;
      all.push(...d.values);
      done = d.isLastPage;
      if (d.nextPageStart !== undefined) start = d.nextPageStart;
      else done = true;
    }
  } else {
    let url: string | undefined = commentsUrl(env);
    while (url) {
      const r = await fetch(url, { method: 'GET', headers: headers(env) });
      if (!r.ok) throw new Error(`Bitbucket Cloud API ${r.status}: ${await r.text()}`);
      const d = (await r.json()) as BBCloudPage<BBComment>;
      all.push(...d.values);
      url = d.next;
    }
  }
  return all;
}

export async function findExistingComment(env: BitbucketEnv): Promise<number | null> {
  const c = (await listPrComments(env)).find((c) => getCommentBody(c).includes(COMMENT_MARKER));
  return c ? c.id : null;
}

export async function postPrComment(env: BitbucketEnv, md: string): Promise<void> {
  const body = isServer(env) ? { text: md } : { content: { raw: md } };
  const r = await fetch(commentsUrl(env), { method: 'POST', headers: headers(env), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Bitbucket API ${r.status}: ${await r.text()}`);
}

export async function updatePrComment(env: BitbucketEnv, id: number, md: string): Promise<void> {
  const url = `${commentsUrl(env)}/${id}`;

  if (isServer(env)) {
    const getRes = await fetch(url, { method: 'GET', headers: headers(env) });
    if (!getRes.ok) throw new Error(`Bitbucket Server API ${getRes.status}: ${await getRes.text()}`);
    const existing = (await getRes.json()) as { version: number };
    const r = await fetch(url, { method: 'PUT', headers: headers(env), body: JSON.stringify({ text: md, version: existing.version }) });
    if (!r.ok) throw new Error(`Bitbucket Server API ${r.status}: ${await r.text()}`);
  } else {
    const r = await fetch(url, { method: 'PUT', headers: headers(env), body: JSON.stringify({ content: { raw: md } }) });
    if (!r.ok) throw new Error(`Bitbucket Cloud API ${r.status}: ${await r.text()}`);
  }
}

export async function deletePrComment(env: BitbucketEnv, id: number): Promise<void> {
  const url = `${commentsUrl(env)}/${id}`;

  if (isServer(env)) {
    const getRes = await fetch(url, { method: 'GET', headers: headers(env) });
    if (!getRes.ok) throw new Error(`Bitbucket Server API ${getRes.status}: ${await getRes.text()}`);
    const existing = (await getRes.json()) as { version: number };
    const r = await fetch(`${url}?version=${existing.version}`, { method: 'DELETE', headers: headers(env) });
    if (!r.ok) throw new Error(`Bitbucket Server API ${r.status}: ${await r.text()}`);
  } else {
    const r = await fetch(url, { method: 'DELETE', headers: headers(env) });
    if (!r.ok) throw new Error(`Bitbucket Cloud API ${r.status}: ${await r.text()}`);
  }
}

/** Upsert a PR comment — update existing or create new. */
export async function upsertPrComment(env: BitbucketEnv, md: string): Promise<void> {
  const marked = withMarker(md);
  const existing = await findExistingComment(env);
  existing !== null ? await updatePrComment(env, existing, marked) : await postPrComment(env, marked);
}
